// Keep typing off the synchronous localStorage path. Continuous editing still
// saves at least once a second; explicit actions and page lifecycle flushes save
// immediately. readState is called at save time so queued work never holds a
// stale scratchpad or resurrects a deleted tab.
export function createHelmScratchpadPersistence({
  readState,
  writeState,
  serialize,
  onError = () => {},
  delayMs = 250,
  maxWaitMs = 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let pending = false
  let delayTimer = null
  let maxTimer = null
  let persistedState = null

  function clearTimers() {
    if (delayTimer !== null) clearTimer(delayTimer)
    if (maxTimer !== null) clearTimer(maxTimer)
    delayTimer = null
    maxTimer = null
  }

  function save(state = readState()) {
    try {
      const serialized = serialize(state)
      if (serialized !== persistedState) {
        writeState(serialized)
        persistedState = serialized
      }
      pending = false
      clearTimers()
      return true
    } catch (error) {
      onError(error)
      return false
    }
  }

  function flush() {
    clearTimers()
    return !pending || save()
  }

  function schedule() {
    pending = true
    if (delayTimer !== null) clearTimer(delayTimer)
    delayTimer = setTimer(flush, delayMs)
    if (maxTimer === null) maxTimer = setTimer(flush, maxWaitMs)
  }

  return { schedule, flush, save }
}
