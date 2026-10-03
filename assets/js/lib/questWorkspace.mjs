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

export function questInputMetadataAvailable(job, workspace) {
  return (
    workspace?.mode === 'resident' &&
    workspace.capabilities?.typedInputs === true &&
    typeof job?.metadataVersion === 'string' &&
    job.metadataVersion.length > 0 &&
    Array.isArray(job.inputs)
  )
}

export function questOverlapLabel(job) {
  return job?.withoutOverlapping === true
    ? 'Prevent overlap in this app process'
    : job?.withoutOverlapping === false
    ? 'Concurrent executions allowed'
    : 'Unavailable'
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

// A selected-job history request owns only one read generation. A slow response
// from a previous job or environment can never replace the current selection.
export function createQuestHistoryLoader(fetchRequest = fetch) {
  let generation = 0
  let controller
  function cancel() {
    generation++
    controller?.abort()
    controller = null
  }
  async function load(url) {
    cancel()
    const current = generation
    controller = new AbortController()
    try {
      const response = await fetchRequest(url, { signal: controller.signal })
      if (!response.ok)
        throw new Error(`Could not load history (HTTP ${response.status}).`)
      const data = await response.json()
      if (!Array.isArray(data?.runs) || !Array.isArray(data?.legacyEvents))
        throw new Error('No valid history was received.')
      if (current !== generation) return { stale: true }
      return { data, error: null }
    } catch (error) {
      if (current !== generation) return { stale: true }
      return { data: null, error: error.message || 'Could not load history.' }
    }
  }
  return { load, cancel }
}

// Format the runtime's supplied timestamp in two named zones. This is display
// only: cron/interval schedules are never interpreted or recomputed here.
export function questDueTimes(timestamp, timezone, options = {}) {
  const formatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }
  const locale = options.locale
  let viewerFormatter
  try {
    viewerFormatter = new Intl.DateTimeFormat(locale, {
      ...formatOptions,
      ...(options.viewerTimeZone ? { timeZone: options.viewerTimeZone } : {})
    })
  } catch {
    viewerFormatter = new Intl.DateTimeFormat(undefined, formatOptions)
  }
  let runtimeFormatter
  let timezoneStatus = 'unreported'
  if (typeof timezone === 'string' && timezone.trim()) {
    try {
      runtimeFormatter = new Intl.DateTimeFormat(locale, {
        ...formatOptions,
        timeZone: timezone
      })
      timezoneStatus = 'available'
    } catch {
      timezoneStatus = 'invalid'
    }
  }
  const date =
    (typeof timestamp === 'number' || typeof timestamp === 'string') &&
    timestamp !== ''
      ? new Date(timestamp)
      : null
  const validDate = date && Number.isFinite(date.getTime())
  return {
    runtime:
      validDate && runtimeFormatter ? runtimeFormatter.format(date) : null,
    runtimeZone: runtimeFormatter?.resolvedOptions().timeZone || null,
    viewer: validDate ? viewerFormatter.format(date) : null,
    viewerZone: viewerFormatter.resolvedOptions().timeZone,
    timezoneStatus
  }
}

export const QUEST_SNAPSHOT_MAX_AGE_MS = 30000
export const QUEST_SNAPSHOT_MAX_SKEW_MS = 5000

export function questSnapshotIsFresh(workspace, now = Date.now()) {
  if (
    workspace?.mode !== 'resident' ||
    !Number.isFinite(workspace.observedAt) ||
    !Number.isFinite(now)
  )
    return false
  const age = now - workspace.observedAt
  return age >= -QUEST_SNAPSHOT_MAX_SKEW_MS && age < QUEST_SNAPSHOT_MAX_AGE_MS
}

// Authority is established only by a valid newly received snapshot. Invalid
// future timestamps cannot become trusted merely because local time catches up.
export function createQuestSnapshotAuthority(options = {}) {
  const currentTime = options.now || Date.now
  const schedule = options.setTimer || setTimeout
  const unschedule = options.clearTimer || clearTimeout
  let timer
  let generation = 0
  let fresh = false
  function publish(value) {
    if (fresh === value) return
    fresh = value
    options.onChange?.(value)
  }
  function clear() {
    generation++
    if (timer !== undefined) unschedule(timer)
    timer = undefined
  }
  function observe(workspace) {
    clear()
    const receivedAt = currentTime()
    const valid = questSnapshotIsFresh(workspace, receivedAt)
    publish(valid)
    if (!valid) return false
    const observedGeneration = generation
    const remaining =
      workspace.observedAt + QUEST_SNAPSHOT_MAX_AGE_MS - receivedAt
    timer = schedule(() => {
      if (observedGeneration !== generation) return
      timer = undefined
      publish(false)
    }, remaining)
    return true
  }
  function dispose() {
    clear()
    publish(false)
  }
  return { observe, dispose, isFresh: () => fresh }
}

export function questResultCountLabel(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}
