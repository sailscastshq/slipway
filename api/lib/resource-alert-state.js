const HIGH_THRESHOLD = 90
const RECOVERY_THRESHOLD = 85
const REQUIRED_SAMPLES = 3
const MAX_SAMPLE_GAP_MS = 2 * 60 * 1000

function advanceResourceAlertState(previous, stat, now) {
  const state = {
    cpuActive: previous?.cpuActive || false,
    memoryActive: previous?.memoryActive || false,
    cpuHighSamples: previous?.cpuHighSamples || 0,
    memoryHighSamples: previous?.memoryHighSamples || 0,
    cpuRecoverySamples: previous?.cpuRecoverySamples || 0,
    memoryRecoverySamples: previous?.memoryRecoverySamples || 0,
    lastSampleAt: now
  }

  if (
    previous?.lastSampleAt &&
    now - previous.lastSampleAt > MAX_SAMPLE_GAP_MS
  ) {
    state.cpuHighSamples = 0
    state.memoryHighSamples = 0
    state.cpuRecoverySamples = 0
    state.memoryRecoverySamples = 0
  }

  const cpuHigh = advance('cpu', stat.cpuPercent, state)
  const memHigh = advance('memory', stat.memPercent, state)

  return { state, cpuHigh, memHigh }
}

function advance(resource, percent, state) {
  const active = `${resource}Active`
  const highSamples = `${resource}HighSamples`
  const recoverySamples = `${resource}RecoverySamples`

  if (percent > HIGH_THRESHOLD) {
    state[recoverySamples] = 0
    if (state[active]) return false
    state[highSamples] += 1
    if (state[highSamples] < REQUIRED_SAMPLES) return false
    state[active] = true
    return true
  }

  state[highSamples] = 0
  if (percent > RECOVERY_THRESHOLD || !state[active]) {
    state[recoverySamples] = 0
    return false
  }

  state[recoverySamples] += 1
  if (state[recoverySamples] >= REQUIRED_SAMPLES) {
    state[active] = false
    state[recoverySamples] = 0
  }
  return false
}

module.exports = { advanceResourceAlertState }
