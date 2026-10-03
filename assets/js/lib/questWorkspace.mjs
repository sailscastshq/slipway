const own = (value, key) =>
  Object.prototype.hasOwnProperty.call(value || {}, key)
const activeStates = new Set([
  'requested',
  'accepted',
  'queued',
  'running',
  'cancelling'
])

export function normalizeQuestWorkspace(workspace, fallback = {}) {
  const source = workspace && workspace.version === 1 ? workspace : {}
  const mode = ['resident', 'legacy', 'unavailable'].includes(source.mode)
    ? source.mode
    : 'unavailable'
  return {
    ...source,
    version: 1,
    mode,
    observedAt: source.observedAt ?? null,
    target: source.target || {},
    capabilities: Object.fromEntries(
      ['invoke', 'pause', 'resume', 'cancel', 'results', 'typedInputs'].map(
        (name) => [
          name,
          mode === 'resident' && source.capabilities?.[name] === true
        ]
      )
    ),
    jobs: Array.isArray(source.jobs) ? source.jobs : fallback.jobs || [],
    runs: Array.isArray(source.runs) ? source.runs : [],
    legacyEvents: Array.isArray(source.legacyEvents)
      ? source.legacyEvents
      : fallback.jobHistory || [],
    nextCursor: source.nextCursor || null,
    historyScope: source.historyScope || 'Last 7 days',
    reason: source.reason || fallback.jobsError || null
  }
}

export function questJobState(job, workspace, fresh = true) {
  if (!fresh || workspace.mode !== 'resident') return 'unavailable'
  if (job.isRunning === true) return 'running'
  if (job.paused === true) return 'paused'
  if (job.paused !== false || job.isRunning !== false) return 'unavailable'
  return job.schedule && job.schedule !== 'manual' ? 'scheduled' : 'manual'
}

export function isActiveQuestRun(run) {
  return activeStates.has(run?.state)
}

export function questRunTime(run) {
  return run.startedAt ?? run.requestedAt ?? run.recordedAt ?? 0
}

export function mergeQuestRuns(current, incoming) {
  const map = new Map(
    current.filter((run) => run.runId).map((run) => [run.runId, run])
  )
  for (const run of incoming) {
    if (!run.runId) continue
    const previous = map.get(run.runId)
    const rank = {
      requested: 0,
      accepted: 0,
      queued: 1,
      running: 2,
      cancelling: 3
    }
    if (
      previous &&
      previous.state &&
      run.state &&
      ((!isActiveQuestRun(previous) && isActiveQuestRun(run)) ||
        (isActiveQuestRun(previous) &&
          isActiveQuestRun(run) &&
          rank[previous.state] > rank[run.state]))
    )
      continue
    map.set(run.runId, { ...previous, ...run })
  }
  return [...map.values()].sort((a, b) => questRunTime(b) - questRunTime(a))
}

export function questInputType(input) {
  const type = input.type
  if (Array.isArray(type)) return 'array'
  if (type && typeof type === 'object') return 'object'
  return [
    'string',
    'number',
    'boolean',
    'json',
    'ref',
    'array',
    'object'
  ].includes(type)
    ? type
    : 'json'
}

// Input drafts stay in component memory. Never persist secrets, results, or
// submitted inputs in query state, localStorage, or browser history.
export function createQuestInputDraft(inputs = [], previous = {}) {
  return Object.fromEntries(
    inputs.map((input) => {
      const type = questInputType(input)
      let value
      if (!input.sensitive) {
        if (own(previous, input.name)) value = previous[input.name]
        else if (own(input, 'defaultsTo')) value = input.defaultsTo
      }
      const included = value !== undefined || input.required === true
      const raw =
        value === undefined
          ? ''
          : ['json', 'ref', 'object', 'array'].includes(type)
          ? JSON.stringify(value, null, 2)
          : value
      return [input.name, { included, raw }]
    })
  )
}

export function validateQuestInputs(inputs = [], draft = {}) {
  const values = {}
  const errors = {}
  for (const input of inputs) {
    const entry = draft[input.name] || { included: false, raw: '' }
    const type = questInputType(input)
    if (!entry.included) {
      if (input.required) errors[input.name] = 'This input is required.'
      continue
    }
    let value = entry.raw
    if (type === 'number') {
      if (
        value === '' ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        !Number.isFinite(Number(value))
      ) {
        errors[input.name] = 'Enter a valid number.'
        continue
      }
      value = Number(value)
    } else if (type === 'boolean') {
      if (input.sensitive && value === 'true') value = true
      if (input.sensitive && value === 'false') value = false
      if (value !== true && value !== false) {
        errors[input.name] = 'Choose true or false.'
        continue
      }
    } else if (['json', 'ref', 'object', 'array'].includes(type)) {
      try {
        value = JSON.parse(value)
      } catch {
        errors[input.name] = 'Enter valid JSON.'
        continue
      }
      if (type === 'array' && !Array.isArray(value)) {
        errors[input.name] = 'Enter a JSON array.'
        continue
      }
      if (
        type === 'object' &&
        (value === null || Array.isArray(value) || typeof value !== 'object')
      ) {
        errors[input.name] = 'Enter a JSON object.'
        continue
      }
    } else if (typeof value !== 'string') {
      errors[input.name] = 'Enter a string.'
      continue
    }
    if (input.required && (value === null || value === '')) {
      errors[input.name] = 'This input is required.'
    } else if (
      Array.isArray(input.isIn) &&
      !input.isIn.some(
        (option) => JSON.stringify(option) === JSON.stringify(value)
      )
    ) {
      errors[input.name] = 'Choose one of the allowed values.'
    } else if (
      typeof value === 'number' &&
      Number.isFinite(input.min) &&
      value < input.min
    ) {
      errors[input.name] = `Must be at least ${input.min}.`
    } else if (
      typeof value === 'number' &&
      Number.isFinite(input.max) &&
      value > input.max
    ) {
      errors[input.name] = `Must be at most ${input.max}.`
    } else if (
      (typeof value === 'string' || Array.isArray(value)) &&
      Number.isFinite(input.minLength) &&
      value.length < input.minLength
    ) {
      errors[input.name] = `Use at least ${input.minLength} characters.`
    } else if (
      (typeof value === 'string' || Array.isArray(value)) &&
      Number.isFinite(input.maxLength) &&
      value.length > input.maxLength
    ) {
      errors[input.name] = `Use at most ${input.maxLength} characters.`
    } else {
      Object.defineProperty(values, input.name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
  }
  return { values, errors, valid: Object.keys(errors).length === 0 }
}

export async function requestQuestInvocation(
  url,
  body,
  csrf = '',
  fetchRequest = fetch
) {
  const unconfirmed = {
    state: 'unconfirmed',
    error:
      'No acceptance was received. The job may have started. Check Runs before submitting again.'
  }
  let response
  try {
    response = await fetchRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body)
    })
  } catch {
    return unconfirmed
  }
  if (!response.ok) {
    let detail
    try {
      detail = await response.json()
    } catch {
      /* A non-JSON rejection is still request evidence only. */
    }
    return {
      state: 'request_failed',
      error:
        typeof detail?.message === 'string'
          ? detail.message
          : `Request rejected (HTTP ${response.status}).`,
      errors: detail?.errors || null
    }
  }
  let data
  try {
    data = await response.json()
  } catch {
    return unconfirmed
  }
  if (
    typeof data?.run?.runId !== 'string' ||
    !data.run.runId ||
    typeof data.run.state !== 'string' ||
    !data.run.state
  )
    return unconfirmed
  return { state: 'accepted', run: data.run }
}

export function formatQuestDuration(ms) {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function questRelativeTime(timestamp, now = Date.now()) {
  if (!timestamp) return '—'
  const seconds = Math.round((timestamp - now) / 1000)
  const absolute = Math.abs(seconds)
  if (absolute < 60) return seconds > 0 ? 'in <1m' : 'just now'
  const text =
    absolute < 3600
      ? `${Math.floor(absolute / 60)}m`
      : absolute < 86400
      ? `${Math.floor(absolute / 3600)}h`
      : `${Math.floor(absolute / 86400)}d`
  return seconds > 0 ? `in ${text}` : `${text} ago`
}

export function questAbsoluteTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString() : '—'
}

export function questErrorText(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  return (
    [error.name, error.message].filter(Boolean).join(': ') ||
    'Execution failed.'
  )
}
