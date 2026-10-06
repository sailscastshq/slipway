const runtime = require('./quest-runtime-client')
const cache = new Map()
module.exports = async function readLiveLogs(app, run, afterSequence = 0) {
  const key = JSON.stringify([
    app.id,
    app.currentDeployment,
    app.containerName,
    run.runtimeId,
    run.runId
  ])
  let entry = cache.get(key)
  if (!entry || (!entry.pending && entry.expires < Date.now())) {
    entry = { expires: Date.now() + 1000, pending: true }
    entry.promise = runtime
      .request(app, 'logs', {
        runId: run.runId,
        runtimeId: run.runtimeId,
        afterSequence: 0
      })
      .then((snapshot) => {
        entry.pending = false
        entry.expires = Date.now() + 1000
        return snapshot
      })
      .catch((error) => {
        cache.delete(key)
        throw error
      })
    cache.set(key, entry)
    if (cache.size > 128) cache.delete(cache.keys().next().value)
  }
  const snapshot = await entry.promise
  if (snapshot.runId !== run.runId || snapshot.runtimeId !== run.runtimeId)
    throw new Error('Quest log identity changed.')
  return {
    ...snapshot,
    entries: snapshot.entries.filter((item) => item.sequence > afterSequence),
    gap:
      snapshot.gap &&
      afterSequence < (snapshot.entries[0]?.sequence || snapshot.sequence)
  }
}
