const DEFAULT_INTERVAL_MS = 60000
const STALE_AFTER_MS = 180000

function initialState() {
  return {
    status: 'unknown',
    lastCheckedAt: null,
    lastSuccessAt: null,
    consecutiveUp: 0,
    consecutiveDown: 0,
    incidentOpenedAt: null
  }
}

// Derive display freshness without erasing an open incident or its history.
function statusAt(state, now = Date.now()) {
  if (
    state.lastCheckedAt === null ||
    now < state.lastCheckedAt ||
    now - state.lastCheckedAt >= STALE_AFTER_MS
  )
    return 'unknown'
  return state.status
}

/** Ordered observations only. Events are data; no notification side effects. */
function observe(previous, result) {
  if (
    !['up', 'down', 'unknown'].includes(result.outcome) ||
    !Number.isSafeInteger(result.checkedAt) ||
    result.checkedAt < 0
  ) {
    throw new Error('BEACON_INVALID_OBSERVATION')
  }
  if (
    previous.lastCheckedAt !== null &&
    result.checkedAt <= previous.lastCheckedAt
  ) {
    return { state: previous, event: null }
  }
  const state = { ...previous }
  // Confirmation must be consecutive in time, not two observations hours apart.
  if (
    previous.lastCheckedAt === null ||
    result.checkedAt - previous.lastCheckedAt >= STALE_AFTER_MS
  ) {
    state.status = 'unknown'
    state.consecutiveUp = 0
    state.consecutiveDown = 0
  }
  state.lastCheckedAt = result.checkedAt
  state.consecutiveUp =
    result.outcome === 'up' ? Math.min(2, state.consecutiveUp + 1) : 0
  state.consecutiveDown =
    result.outcome === 'down' ? Math.min(2, state.consecutiveDown + 1) : 0
  let event = null
  if (result.outcome === 'unknown') state.status = 'unknown'
  if (result.outcome === 'up') state.lastSuccessAt = result.checkedAt
  if (state.consecutiveDown >= 2) {
    state.status = 'down'
    if (state.incidentOpenedAt === null) {
      state.incidentOpenedAt = result.checkedAt
      event = { type: 'incident_opened', at: result.checkedAt }
    }
  }
  if (state.consecutiveUp >= 2) {
    state.status = 'up'
    if (state.incidentOpenedAt !== null) {
      event = {
        type: 'incident_resolved',
        at: result.checkedAt,
        openedAt: state.incidentOpenedAt
      }
      state.incidentOpenedAt = null
    }
  }
  return { state, event }
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  STALE_AFTER_MS,
  initialState,
  statusAt,
  observe
}
