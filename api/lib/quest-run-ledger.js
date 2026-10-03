const crypto = require('node:crypto')
const { sanitizeQuestDiagnostic } = require('./contracts/quest-diagnostics')

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RESULT_BYTES = 128 * 1024
const MAX_LOG_BYTES = 64 * 1024
const MAX_INPUT_BYTES = 32 * 1024
const MAX_DEPTH = 12
const MAX_NODES = 4096
const TERMINAL = new Set([
  'completed',
  'failed',
  'skipped',
  'cancelled',
  'timed_out',
  'interrupted'
])
const STATES = new Set(['requested', 'running', 'unconfirmed', ...TERMINAL])
const RESULT_STATUSES = new Set([
  'available',
  'undefined',
  'unsupported',
  'too_large',
  'serialization_error',
  'unavailable'
])
const LEGACY_NAMES = [
  'quest.job.started',
  'quest.job.start',
  'quest.job.completed',
  'quest.job.complete',
  'quest.job.failed',
  'quest.job.error',
  'quest.job.skipped',
  'quest.job.cancelled',
  'quest.job.timed_out',
  'quest.job.interrupted'
]
const SUMMARY_FIELDS = [
  'id',
  'runId',
  'jobName',
  'state',
  'trigger',
  'actor',
  'requestedAt',
  'startedAt',
  'finishedAt',
  'duration',
  'exitCode',
  'resultStatus'
]
const SENSITIVE_KEY =
  /password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|authorization/i

function failure(code, message) {
  return Object.assign(new Error(message), { code })
}
function timestamp(value, fallback = null) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}
function boundedText(value, maxBytes, options = {}) {
  const clean = sanitizeQuestDiagnostic(
    typeof value === 'string' ? value : '',
    options
  )
  const bytes = Buffer.from(clean)
  if (bytes.length <= maxBytes) return { value: clean, truncated: false }
  // Decode only complete UTF-8 characters: replacement characters can exceed the budget.
  let start = bytes.length - maxBytes
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
  return { value: bytes.subarray(start).toString('utf8'), truncated: true }
}
function sanitizeValue(value, options = {}) {
  const seen = new WeakSet()
  let nodes = 0
  const walk = (item, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH)
      throw failure(
        'QUEST_VALUE_TOO_LARGE',
        'Quest value exceeds structural limits.'
      )
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'string')
      return sanitizeQuestDiagnostic(item, {
        ...options,
        preserveWhitespace: true
      })
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (typeof item !== 'object')
      throw failure(
        'QUEST_VALUE_UNSUPPORTED',
        'Quest value is not JSON serializable.'
      )
    if (seen.has(item))
      throw failure(
        'QUEST_VALUE_SERIALIZATION',
        'Quest value contains a cycle.'
      )
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw failure(
        'QUEST_VALUE_UNSUPPORTED',
        'Quest value must use ordinary JSON objects.'
      )
    seen.add(item)
    const result = Array.isArray(item) ? [] : {}
    for (const key of Object.keys(item)) {
      if (++nodes > MAX_NODES || Buffer.byteLength(key) > 1024)
        throw failure(
          'QUEST_VALUE_TOO_LARGE',
          'Quest value exceeds structural limits.'
        )
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value'))
        throw failure(
          'QUEST_VALUE_SERIALIZATION',
          'Quest value contains an accessor.'
        )
      result[key] = SENSITIVE_KEY.test(key)
        ? '<redacted>'
        : walk(descriptor.value, depth + 1)
    }
    seen.delete(item)
    return result
  }
  return walk(value, 0)
}
function serializeResultEnvelope(result, options = {}) {
  if (!result || !RESULT_STATUSES.has(result.status))
    return { status: 'unavailable' }
  if (result.status !== 'available')
    return {
      status: result.status,
      ...(result.truncated ? { truncated: true } : {})
    }
  if (result.value === undefined) return { status: 'undefined' }
  try {
    const value = sanitizeValue(result.value, options)
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_RESULT_BYTES)
      return { status: 'too_large', truncated: true }
    return { status: 'available', value }
  } catch (error) {
    return {
      status:
        error.code === 'QUEST_VALUE_TOO_LARGE'
          ? 'too_large'
          : error.code === 'QUEST_VALUE_UNSUPPORTED'
          ? 'unsupported'
          : 'serialization_error',
      ...(error.code === 'QUEST_VALUE_TOO_LARGE' ? { truncated: true } : {})
    }
  }
}
function resultEnvelope(result, options = {}) {
  const envelope = serializeResultEnvelope(result, options)
  // A named machine exit is a business outcome, independent of process exitCode.
  if (
    typeof result?.exit === 'string' &&
    /^[a-zA-Z0-9_.:-]{1,128}$/.test(result.exit)
  )
    envelope.exit = result.exit
  return envelope
}
function normalizedScope(scope) {
  if (!scope || scope.environmentId == null || scope.appId == null)
    throw failure(
      'QUEST_SCOPE_REQUIRED',
      'Quest reads and writes require an environment and app.'
    )
  return { environment: String(scope.environmentId), app: String(scope.appId) }
}
function modelFor(options) {
  return options.model || global.QuestRun
}
function nowFor(options) {
  return options.now ?? Date.now()
}
function scopeWhere(scope, options) {
  return {
    ...normalizedScope(scope),
    requestedAt: { '>=': nowFor(options) - RETENTION_MS }
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  return value
}

async function admit(input, options = {}) {
  const scope = normalizedScope(input)
  if (
    typeof input.runId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(input.runId)
  )
    throw failure(
      'QUEST_INVALID_RUN_ID',
      'Quest requires a bounded, stable run ID.'
    )
  if (
    typeof input.jobName !== 'string' ||
    !input.jobName ||
    Buffer.byteLength(input.jobName) > 256
  )
    throw failure('QUEST_INVALID_JOB', 'Quest requires a bounded job name.')
  const inputs = sanitizeValue(input.inputs ?? {}, options)
  if (
    !inputs ||
    Array.isArray(inputs) ||
    typeof inputs !== 'object' ||
    Buffer.byteLength(JSON.stringify(inputs)) > MAX_INPUT_BYTES
  )
    throw failure(
      'QUEST_INVALID_INPUTS',
      'Quest inputs must be a bounded JSON object.'
    )
  // Hash original validated inputs to detect reuse even when only a secret changes.
  let serialized
  try {
    serialized = JSON.stringify(canonical(input.inputs ?? {}))
  } catch {
    throw failure('QUEST_INVALID_INPUTS', 'Quest inputs must be serializable.')
  }
  const inputHash = crypto.createHash('sha256').update(serialized).digest('hex')
  const requestKey = input.requestId
    ? crypto
        .createHash('sha256')
        .update(
          JSON.stringify([
            scope.environment,
            scope.app,
            input.deploymentId || null,
            input.jobName,
            input.requestId
          ])
        )
        .digest('hex')
    : null
  const model = modelFor(options)
  const lookup = requestKey
    ? { or: [{ runId: input.runId }, { requestKey }] }
    : { runId: input.runId }
  const existing = await model.findOne(lookup)
  const checkExisting = (run) => {
    if (
      run.environment !== scope.environment ||
      run.app !== scope.app ||
      run.jobName !== input.jobName ||
      run.inputHash !== inputHash ||
      (run.deploymentId || null) !==
        (input.deploymentId == null ? null : String(input.deploymentId))
    )
      throw failure(
        'QUEST_RUN_CONFLICT',
        'Quest run ID or request key was already used for a different request.'
      )
    return run
  }
  if (existing) return checkExisting(existing)
  const requestedAt = timestamp(input.requestedAt, nowFor(options))
  if (
    requestedAt < nowFor(options) - RETENTION_MS ||
    requestedAt > nowFor(options) + 60000
  )
    throw failure(
      'QUEST_INVALID_TIMESTAMP',
      'Quest run is outside the retention window.'
    )
  const values = {
    ...scope,
    runId: input.runId,
    requestKey,
    inputHash,
    deploymentId:
      input.deploymentId == null
        ? null
        : String(input.deploymentId).slice(0, 128),
    runtimeId:
      input.runtimeId == null
        ? null
        : boundedText(String(input.runtimeId), 256, options).value,
    jobName: boundedText(input.jobName, 256, options).value,
    actor: input.actor == null ? null : sanitizeValue(input.actor, options),
    trigger: ['manual', 'scheduled', 'cli'].includes(input.trigger)
      ? input.trigger
      : 'manual',
    state: input.state === 'running' ? 'running' : 'requested',
    sequence: timestamp(input.sequence, 0),
    requestedAt,
    startedAt: timestamp(input.startedAt),
    inputs,
    result: { status: 'unavailable' },
    resultStatus: 'unavailable'
  }
  if (Buffer.byteLength(JSON.stringify(values.actor)) > 4096)
    values.actor = null
  try {
    return await model.create(values).fetch()
  } catch (error) {
    if (error.code !== 'E_UNIQUE') throw error
    const concurrent = await model.findOne(lookup)
    if (!concurrent) throw error
    return checkExisting(concurrent)
  }
}

async function ingest(event, scope, options = {}) {
  if (event.logs && typeof event.logs === 'object')
    event = {
      ...event,
      stdout: event.stdout ?? event.logs.stdout,
      stderr: event.stderr ?? event.logs.stderr,
      logsTruncated: !!(
        event.logsTruncated ||
        event.logs.stdoutTruncated ||
        event.logs.stderrTruncated
      )
    }
  if (
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 0 ||
    !STATES.has(event.state)
  )
    throw failure(
      'QUEST_INVALID_EVENT',
      'Quest event needs a monotonic sequence and known state.'
    )
  const model = modelFor(options)
  const where = { ...scopeWhere(scope, options), runId: event.runId }
  for (let attempt = 0; attempt < 5; attempt++) {
    const run = await model.findOne(where)
    if (!run) return null // Only admission creates a run; uncorrelated events stay uncorrelated.
    if (event.sequence <= run.sequence || TERMINAL.has(run.state)) return run
    const state =
      event.state === 'requested' && run.state !== 'requested'
        ? run.state
        : event.state
    const values = { state, sequence: event.sequence }
    if (event.signal !== undefined)
      values.signal = boundedText(event.signal, 128, options).value || null
    if (event.startedAt != null && run.startedAt == null)
      values.startedAt = timestamp(event.startedAt)
    if (TERMINAL.has(state)) {
      values.finishedAt = timestamp(event.finishedAt, nowFor(options))
      values.duration = timestamp(
        event.duration,
        run.startedAt == null && values.startedAt == null
          ? null
          : Math.max(0, values.finishedAt - (run.startedAt ?? values.startedAt))
      )
      values.exitCode =
        Number.isInteger(event.exitCode) && event.exitCode >= 0
          ? event.exitCode
          : null
      values.signal = boundedText(event.signal, 128, options).value || null
      values.result = resultEnvelope(event.result, options)
      values.resultStatus = values.result.status
      values.error = null
    }
    if (event.error !== undefined)
      values.error =
        boundedText(event.error, MAX_LOG_BYTES, options).value || null
    if (event.stdout !== undefined || event.stderr !== undefined) {
      const stdout = boundedText(
        event.stdout ?? run.stdout,
        MAX_LOG_BYTES,
        options
      )
      const stderr = boundedText(
        event.stderr ?? run.stderr,
        MAX_LOG_BYTES,
        options
      )
      values.stdout = stdout.value
      values.stderr = stderr.value
      values.logsTruncated = !!(
        run.logsTruncated ||
        event.truncated ||
        event.logsTruncated ||
        stdout.truncated ||
        stderr.truncated
      )
      values.logsAvailable = true
    }
    // Compare-and-set also protects parallel ingestion in another server process.
    const updated = await model
      .updateOne({ ...where, sequence: run.sequence })
      .set(values)
    if (updated) return updated
  }
  throw failure(
    'QUEST_INGEST_CONFLICT',
    'Quest run changed while recording its receipt; retry the event.'
  )
}

async function markUnconfirmed(scope, runId, reason, options = {}) {
  const model = modelFor(options)
  const where = { ...scopeWhere(scope, options), runId }
  // This is a control-plane observation, not an invented engine event. Keep
  // sequence unchanged so a delayed genuine terminal receipt can still win.
  const updated = await model
    .updateOne({ ...where, state: { in: ['requested', 'running'] } })
    .set({
      state: 'unconfirmed',
      error: boundedText(
        reason ||
          'The resident runtime is no longer available; execution outcome is unconfirmed.',
        MAX_LOG_BYTES,
        options
      ).value
    })
  return updated || (await model.findOne(where))
}

function summary(run) {
  return Object.fromEntries(
    SUMMARY_FIELDS.filter((key) => key !== 'id').map((key) => [
      key,
      run[key] ?? null
    ])
  )
}
async function getReceiptMeta(scope, runId, options = {}) {
  const run = await modelFor(options)
    .findOne({ ...scopeWhere(scope, options), runId })
    .select(['sequence', 'runtimeId', 'state'])
  return run
    ? { sequence: run.sequence, runtimeId: run.runtimeId, state: run.state }
    : null
}
async function getRun(scope, runId, options = {}) {
  const run = await modelFor(options)
    .findOne({ ...scopeWhere(scope, options), runId })
    .select([
      ...SUMMARY_FIELDS,
      'sequence',
      'inputs',
      'result',
      'error',
      'signal',
      'deploymentId',
      'runtimeId'
    ])
  return run
    ? {
        ...summary(run),
        sequence: run.sequence,
        inputs: run.inputs,
        result: run.result || { status: 'unavailable' },
        error: run.error || null,
        signal: run.signal || null,
        deploymentId: run.deploymentId,
        runtimeId: run.runtimeId
      }
    : null
}
async function getLogs(scope, runId, options = {}) {
  const run = await modelFor(options)
    .findOne({ ...scopeWhere(scope, options), runId })
    .select(['stdout', 'stderr', 'logsTruncated', 'logsAvailable'])
  return run
    ? {
        stdout: run.stdout || '',
        stderr: run.stderr || '',
        truncated: !!run.logsTruncated,
        available: !!run.logsAvailable
      }
    : null
}
function legacySummary(event, options = {}) {
  const attributes = event.attributes || {}
  const name = event.name.slice('quest.job.'.length)
  return {
    eventId: event.id,
    jobName: boundedText(attributes.jobName, 256, options).value,
    event:
      name === 'complete'
        ? 'completed'
        : name === 'error'
        ? 'failed'
        : name === 'start'
        ? 'started'
        : name,
    duration: event.value,
    error: boundedText(attributes.error, 4096, options).value || null,
    trigger: ['manual', 'scheduled', 'cli'].includes(attributes.trigger)
      ? attributes.trigger
      : 'scheduled',
    recordedAt: event.recordedAt,
    legacy: true
  }
}
function legacyOwned(event, scope) {
  const attrs = event.attributes || {}
  if (attrs.runId || attrs.questRun) return false
  const appId = attrs.appId ?? attrs.app
  return appId == null
    ? scope.includeLegacy !== false
    : String(appId) === String(scope.appId)
}
async function getEvent(scope, eventId, options = {}) {
  normalizedScope(scope)
  if (
    !/^\d+$/.test(String(eventId)) ||
    !Number.isSafeInteger(Number(eventId)) ||
    Number(eventId) < 1
  )
    return null
  const event = await (options.metrics || global.TelemetryMetric).findOne({
    id: Number(eventId),
    environment: String(scope.environmentId),
    name: { in: LEGACY_NAMES },
    recordedAt: { '>=': nowFor(options) - RETENTION_MS }
  })
  if (!event || !legacyOwned(event, scope)) return null
  return {
    ...legacySummary(event, options),
    stdout: boundedText(event.attributes?.stdout, MAX_LOG_BYTES, options).value,
    stderr: boundedText(event.attributes?.stderr, MAX_LOG_BYTES, options).value
  }
}
function normalizeJobFilter(job) {
  if (job == null || job === '') return null
  if (
    typeof job !== 'string' ||
    Buffer.byteLength(job) > 256 ||
    /[\u0000-\u001f\u007f]/.test(job)
  )
    throw failure(
      'QUEST_INVALID_JOB_FILTER',
      'Quest history job must be a string of at most 256 UTF-8 bytes without control characters.'
    )
  return job
}
function decodeCursor(cursor, scope, job) {
  if (!cursor) return null
  try {
    if (
      typeof cursor !== 'string' ||
      cursor.length > 2048 ||
      !/^[a-zA-Z0-9_-]+$/.test(cursor)
    )
      throw new Error()
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (
      parsed.v !== 1 ||
      parsed.environment !== String(scope.environmentId) ||
      parsed.app !== String(scope.appId) ||
      (parsed.job ?? null) !== job ||
      !['run', 'event'].includes(parsed.kind) ||
      !['at', 'id', 'asOf', 'maxRunId', 'maxEventId'].every(
        (key) => Number.isSafeInteger(parsed[key]) && parsed[key] >= 0
      )
    )
      throw new Error()
    return { ...parsed, job }
  } catch {
    throw failure('QUEST_INVALID_CURSOR', 'Invalid Quest history cursor.')
  }
}
function order(left, right) {
  return (
    right.at - left.at ||
    right.kind.localeCompare(left.kind) ||
    right.id - left.id
  )
}
// Project only summary JSON fields in SQLite. A history page must never load
// historical stdout/stderr or arbitrary payloads merely to show one row.
async function listLegacySummaries(metrics, scope, position, limit, options) {
  const attributes =
    "CASE WHEN json_valid(attributes) THEN attributes ELSE '{}' END"
  const app = `CAST(COALESCE(json_extract(${attributes}, '$.appId'), json_extract(${attributes}, '$.app')) AS TEXT)`
  const clauses = [
    'environment = ?',
    `name IN (${LEGACY_NAMES.map(() => '?').join(',')})`,
    'recorded_at >= ?',
    'recorded_at <= ?',
    'id <= ?',
    `COALESCE(json_extract(${attributes}, '$.runId'), '') = ''`,
    `json_extract(${attributes}, '$.questRun') IS NULL`,
    scope.includeLegacy === false
      ? `${app} = ?`
      : `(${app} IS NULL OR ${app} = ?)`
  ]
  const values = [
    String(scope.environmentId),
    ...LEGACY_NAMES,
    nowFor(options) - RETENTION_MS,
    position.asOf,
    position.maxEventId,
    String(scope.appId)
  ]
  if (position.job !== null) {
    clauses.push(
      `json_type(${attributes}, '$.jobName') = 'text' AND json_extract(${attributes}, '$.jobName') = ?`
    )
    values.push(position.job)
  }
  if (position.at != null) {
    if (position.kind === 'event') {
      clauses.push('(recorded_at < ? OR (recorded_at = ? AND id < ?))')
      values.push(position.at, position.at, position.id)
    } else {
      // Runs sort ahead of legacy events when their timestamps are equal.
      clauses.push('recorded_at <= ?')
      values.push(position.at)
    }
  }
  const textField = (key) =>
    `CASE WHEN json_type(${attributes}, '$.${key}') = 'text' THEN json_extract(${attributes}, '$.${key}') ELSE NULL END`
  const result = await metrics.getDatastore().sendNativeQuery(
    `
    SELECT id, name, value, recorded_at AS recordedAt,
      ${textField('jobName')} AS jobName,
      ${textField('error')} AS error,
      ${textField('trigger')} AS trigger
    FROM telemetry_metrics WHERE ${clauses.join(' AND ')}
    ORDER BY recorded_at DESC, id DESC LIMIT ?
  `,
    [...values, limit]
  )
  return (result.rows || result || []).map((row) => ({
    ...row,
    attributes: { jobName: row.jobName, error: row.error, trigger: row.trigger }
  }))
}
async function listRuns(scope, { job, cursor, limit = 25 } = {}, options = {}) {
  job = normalizeJobFilter(job)
  const where = {
    ...scopeWhere(scope, options),
    ...(job !== null ? { jobName: job } : {})
  }
  if (!Number.isInteger(limit) || limit < 1)
    throw failure(
      'QUEST_INVALID_LIMIT',
      'Quest history limit must be a positive integer.'
    )
  limit = Math.min(limit, 50)
  const model = modelFor(options)
  const metrics = options.metrics || global.TelemetryMetric
  const legacyWhere = {
    environment: where.environment,
    name: { in: LEGACY_NAMES },
    recordedAt: { '>=': nowFor(options) - RETENTION_MS }
  }
  let position = decodeCursor(cursor, scope, job)
  if (!position) {
    const [runs, events] = await Promise.all([
      model.find(where).select(['id']).sort('id DESC').limit(1),
      metrics.find(legacyWhere).select(['id']).sort('id DESC').limit(1)
    ])
    position = {
      v: 1,
      ...normalizedScope(scope),
      job,
      asOf: nowFor(options),
      maxRunId: runs[0]?.id || 0,
      maxEventId: events[0]?.id || 0
    }
  }
  const before = (kind, field) => {
    const time = { '>=': nowFor(options) - RETENTION_MS, '<=': position.asOf }
    if (position.at == null) return { [field]: time }
    return {
      [field]: time,
      or: [
        { [field]: { '<': position.at } },
        {
          [field]: position.at,
          ...(kind === position.kind
            ? { id: { '<': position.id } }
            : kind.localeCompare(position.kind) < 0
            ? {}
            : { id: -1 })
        }
      ]
    }
  }
  const runs = await model
    .find({
      ...where,
      ...before('run', 'requestedAt'),
      id: { '<=': position.maxRunId }
    })
    .select(SUMMARY_FIELDS)
    .sort([{ requestedAt: 'DESC' }, { id: 'DESC' }])
    .limit(limit + 1)
  const events = await listLegacySummaries(
    metrics,
    scope,
    position,
    limit + 1,
    options
  )
  const merged = [
    ...runs.map((run) => ({
      kind: 'run',
      at: run.requestedAt,
      id: run.id,
      value: run
    })),
    ...events.map((event) => ({
      kind: 'event',
      at: event.recordedAt,
      id: event.id,
      value: event
    }))
  ].sort(order)
  const page = merged.slice(0, limit)
  const last = page[page.length - 1]
  const next = merged.length > limit ? last : null
  const nextCursor = next
    ? Buffer.from(
        JSON.stringify({
          ...position,
          at: next.at,
          id: next.id,
          kind: next.kind
        })
      ).toString('base64url')
    : null
  return {
    runs: page
      .filter((item) => item.kind === 'run')
      .map((item) => summary(item.value)),
    legacyEvents: page
      .filter((item) => item.kind === 'event')
      .map((item) => legacySummary(item.value, options)),
    nextCursor
  }
}
async function prune(options = {}) {
  const model = modelFor(options)
  const expired = await model
    .find({ requestedAt: { '<': nowFor(options) - RETENTION_MS } })
    .select(['id'])
    .sort('id ASC')
    .limit(500)
  if (expired.length)
    await model.destroy({ id: { in: expired.map((run) => run.id) } })
  return { deleted: expired.length, hasMore: expired.length === 500 }
}

async function resolveScope(
  req,
  { projectSlug, environmentSlug = 'production', appId }
) {
  const user = await User.forRequest(req)
  const teamId = typeof user?.team === 'object' ? user.team?.id : user?.team
  if (!teamId) throw 'notFound'
  const project = await Project.findOne({ slug: projectSlug, team: teamId })
  if (!project) throw 'notFound'
  const environment = await Environment.findOne({
    project: project.id,
    slug: environmentSlug
  })
  if (!environment) throw 'notFound'
  const defaultApp =
    (await App.findOne({ environment: environment.id, isDefault: true })) ||
    (await App.find({ environment: environment.id }).sort('id ASC').limit(1))[0]
  const app =
    appId == null
      ? defaultApp
      : await App.findOne({ id: appId, environment: environment.id })
  if (!app) throw 'notFound'
  return {
    environmentId: environment.id,
    appId: app.id,
    includeLegacy: app.id === defaultApp?.id
  }
}

module.exports = {
  admit,
  create: admit,
  ingest,
  markUnconfirmed,
  getRun,
  getReceiptMeta,
  getLogs,
  getEvent,
  listRuns,
  prune,
  resolveScope,
  summary,
  resultEnvelope,
  sanitizeValue,
  boundedText,
  RETENTION_MS,
  MAX_RESULT_BYTES,
  MAX_LOG_BYTES,
  MAX_INPUT_BYTES,
  LEGACY_NAMES
}
