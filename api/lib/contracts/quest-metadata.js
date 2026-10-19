// Dashboard-owned v1 Quest metadata projection. The hook is independently
// packaged; parity fixtures keep these read-only contract functions aligned.
const crypto = require('node:crypto')
const { sanitizeQuestDiagnostic } = require('./quest-diagnostics')
const sensitive =
  /password|passwd|secret|token|api.?key|credential|private.?key/i
const fail = (message, code = 'QUEST_UNAVAILABLE') =>
  Object.assign(new Error(message), { code })
const digest = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

function safeValue(value, depth = 0, seen = new Set(), redactor) {
  if (depth > 8)
    throw fail('Value exceeds the nesting limit.', 'QUEST_INPUT_INVALID')
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return redactor ? redactor.value(value) : value
  if (typeof value === 'string' && redactor && redactor.value(value) !== value)
    return '<redacted>'
  if (typeof value === 'string')
    return redactor
      ? redactor.text(value, { preserveWhitespace: true })
      : sanitizeQuestDiagnostic(value, { preserveWhitespace: true })
  if (!value || typeof value !== 'object' || seen.has(value))
    throw fail('Value is not JSON-compatible.', 'QUEST_INPUT_INVALID')
  seen.add(value)
  let result
  if (Array.isArray(value))
    result = value.map((item) => safeValue(item, depth + 1, seen, redactor))
  else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw fail('Value must be a plain object.', 'QUEST_INPUT_INVALID')
    result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactor ? redactor.text(key, { preserveWhitespace: true }) : key,
        sensitive.test(key)
          ? '<redacted>'
          : safeValue(item, depth + 1, seen, redactor)
      ])
    )
  }
  seen.delete(value)
  return result
}

// Redact business data without renaming the result transport's fixed keys or
// treating its status/validated named exit as an echoed input value.

function describeScheduledInputs(metadata, inputs) {
  if (
    !metadata ||
    metadata.validation !== 'not_checked' ||
    !metadata.fields ||
    typeof metadata.fields !== 'object' ||
    Array.isArray(metadata.fields) ||
    !metadata.values ||
    typeof metadata.values !== 'object' ||
    Array.isArray(metadata.values)
  )
    return null
  const sources = new Set([
    'job_input',
    'script_input',
    'schema_default',
    'omitted'
  ])
  const values = {},
    fields = {}
  const limitBytes = 16 * 1024
  let usedBytes = 2
  for (const input of inputs) {
    const field = metadata.fields[input.name]
    if (!field || !sources.has(field.source)) continue
    const secret = input.sensitive || field.sensitive === true
    const output = {
      source: field.source,
      sensitive: secret,
      available: false,
      missingRequired: input.required && field.missingRequired === true
    }
    if (secret) output.reason = 'sensitive'
    else if (
      field.available === true &&
      field.source !== 'omitted' &&
      Object.hasOwn(metadata.values, input.name)
    ) {
      try {
        const value = safeValue(metadata.values[input.name])
        const bytes = Buffer.byteLength(JSON.stringify({ [input.name]: value }))
        if (bytes > limitBytes) output.reason = 'too_large'
        else if (usedBytes + bytes > limitBytes)
          output.reason = 'metadata_limit'
        else {
          Object.defineProperty(values, input.name, { value, enumerable: true })
          output.available = true
          usedBytes += bytes
        }
      } catch {
        output.reason = 'serialization_error'
      }
    } else if (
      ['too_large', 'serialization_error', 'metadata_limit'].includes(
        field.reason
      )
    )
      output.reason = field.reason
    Object.defineProperty(fields, input.name, {
      value: output,
      enumerable: true
    })
  }
  return { values, fields, validation: 'not_checked', limitBytes }
}

function describeScheduleState(state) {
  if (
    !state ||
    ![
      'not_attempted',
      'registered',
      'not_registered',
      'stopped',
      'consumed',
      'failed'
    ].includes(state.registration) ||
    !['not_checked', 'valid', 'invalid'].includes(state.validation)
  )
    return null
  const validationErrors = (
    Array.isArray(state.validationErrors) ? state.validationErrors : []
  )
    .slice(0, 8)
    .filter((error) => error && typeof error.message === 'string')
    .map((error) => ({
      code:
        typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/i.test(error.code)
          ? error.code
          : 'QUEST_SCHEDULE_INVALID',
      message: sanitizeQuestDiagnostic(error.message.slice(0, 512))
    }))
  const restart = state.restart
  return {
    registration: state.registration,
    validation: state.validation,
    validationErrors,
    reason: ['no_schedule', 'no_future_run'].includes(state.reason)
      ? state.reason
      : null,
    lastAttemptAt:
      typeof state.lastAttemptAt === 'string' &&
      Number.isFinite(Date.parse(state.lastAttemptAt))
        ? new Date(state.lastAttemptAt).toISOString()
        : null,
    restart:
      restart &&
      restart.persistence === 'memory_only' &&
      ['relative_to_registration', 'wall_clock', 'none'].includes(
        restart.timing
      ) &&
      typeof restart.oneShot === 'boolean' &&
      restart.missedRuns === 'not_replayed'
        ? {
            persistence: restart.persistence,
            timing: restart.timing,
            oneShot: restart.oneShot,
            missedRuns: restart.missedRuns
          }
        : null
  }
}

function describeJob(job) {
  const inputs = Object.entries(job.inputs || {}).map(([name, field]) => {
    const secret =
      field.sensitive === true ||
      field.protect === true ||
      field.secret === true ||
      sensitive.test(name)
    const output = {
      name,
      type: field.type || 'ref',
      required: field.required === true,
      sensitive: secret
    }
    for (const key of [
      'friendlyName',
      'description',
      'allowNull',
      'isInteger',
      'isIn',
      'min',
      'max',
      'minLength',
      'maxLength'
    ]) {
      if (field[key] !== undefined)
        try {
          output[key] = safeValue(field[key])
        } catch {
          /* unsupported metadata stays server-side */
        }
    }
    if (!secret && field.defaultsTo !== undefined)
      try {
        output.defaultsTo = safeValue(field.defaultsTo)
      } catch {
        /* no unsafe defaults */
      }
    output.serverValidated = Boolean(
      field.custom ||
        field.customValidation ||
        field.serverValidated ||
        field.isEmail ||
        field.isURL ||
        field.regex ||
        !['string', 'number', 'boolean', 'json', 'ref'].includes(output.type)
    )
    return output
  })
  const schedule = job.schedule || {}
  const type = schedule.cron
    ? 'cron'
    : ['interval', 'timeout', 'date'].find(
        (key) => schedule[key] !== undefined && schedule[key] !== false
      ) || 'manual'
  const scheduleState = describeScheduleState(job.scheduleState)
  const safe = {
    name: job.name,
    script: job.script,
    friendlyName: job.friendlyName || job.name,
    description: job.description || '',
    inputMetadataAvailable: job.inputMetadataAvailable === true,
    inputs,
    schedule: type === 'manual' ? null : schedule[type],
    scheduleType: type,
    timezone: typeof schedule.timezone === 'string' ? schedule.timezone : null,
    nextRunAt: job.nextRunAt ? new Date(job.nextRunAt).getTime() : null,
    paused: typeof job.paused === 'boolean' ? job.paused : null,
    isRunning:
      Number.isSafeInteger(job.runningCount) && job.runningCount >= 0
        ? job.runningCount > 0
        : null,
    withoutOverlapping:
      typeof job.withoutOverlapping === 'boolean'
        ? job.withoutOverlapping
        : null,
    scheduled: typeof job.scheduled === 'boolean' ? job.scheduled : null,
    scheduledInputs: describeScheduledInputs(job.scheduledInputs, inputs),
    scheduleState
  }
  safe.metadataVersion = digest({
    name: safe.name,
    script: safe.script,
    inputs,
    schedule,
    inputMetadataAvailable: safe.inputMetadataAvailable,
    scheduledInputs: safe.scheduledInputs
  })
  return safe
}

module.exports = { safeValue, describeJob }
