// Retry observation and idempotent progress persistence only. Never wrap an
// executor command, transaction body, admission or external side effect here.
module.exports = async function retryObservation(work, options = {}) {
  const wait =
    options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now || Date.now
  const deadline = Math.min(options.deadline ?? Infinity, now() + 1500)
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted()
    if (now() >= deadline) throw new Error('CI observation deadline exceeded.')
    try {
      return await work()
    } catch (error) {
      if (!isContention(error) || attempt >= 4) throw error
      const delay = 50 * (attempt + 1)
      if (now() + delay >= deadline) throw error
      await wait(delay)
    }
  }
}
function isContention(error) {
  const seen = new Set()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    if (
      /^SQLITE_BUSY(?:_SNAPSHOT|_RECOVERY)?$/.test(
        error.sqliteCode || error.code || ''
      ) ||
      error.code === 'E_BUSY'
    )
      return true
    error = error.raw || error.cause
  }
  return false
}
module.exports.isContention = isContention
