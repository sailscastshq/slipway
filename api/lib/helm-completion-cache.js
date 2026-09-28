const MAX_ENTRIES = 32
const TTL_MS = 30_000
const entries = new Map()

async function getHelmCompletions(key, load, now = Date.now()) {
  const existing = entries.get(key)
  if (existing && (existing.promise || existing.expiresAt > now)) {
    return existing.promise || existing.value
  }

  const entry = { promise: null, value: null, expiresAt: 0 }
  entry.promise = Promise.resolve()
    .then(load)
    .then((value) => {
      if (entries.get(key) === entry) {
        if (value?.available) {
          entry.value = value
          entry.expiresAt = Date.now() + TTL_MS
          entry.promise = null
        } else {
          entries.delete(key)
        }
      }
      return value
    })
    .catch((error) => {
      if (entries.get(key) === entry) entries.delete(key)
      throw error
    })
  entries.delete(key)
  entries.set(key, entry)
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value)
  return entry.promise
}

module.exports = { getHelmCompletions }
