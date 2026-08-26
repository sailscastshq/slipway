const queryEvent = 'klean:query-state'

function availableStorage(storage) {
  if (typeof window === 'undefined') return null
  try {
    return typeof storage === 'function' ? storage() : storage
  } catch {
    return null
  }
}

function report(options, error) {
  options.onError?.(error)
}

function remove(store, key, options = {}) {
  if (!store) return
  try {
    store.removeItem(key)
  } catch (error) {
    report(options, error)
  }
}

export function durableKey(key, options = {}) {
  const namespace = options.namespace || 'app'
  const version = Number.isFinite(options.version) ? options.version : 1
  return `klean:${namespace}:${key}:v${version}`
}

export function readStored(key, fallback, options = {}) {
  const store = availableStorage(options.storage ?? (() => localStorage))
  const resolvedKey = durableKey(key, options)
  if (!store) return { found: false, key: resolvedKey, value: fallback }

  try {
    const raw = store.getItem(resolvedKey)
    if (!raw) return { found: false, key: resolvedKey, value: fallback }
    const record = JSON.parse(raw)
    const version = Number.isFinite(options.version) ? options.version : 1

    if (!record || record.version !== version || !('value' in record)) {
      remove(store, resolvedKey, options)
      return { found: false, key: resolvedKey, value: fallback }
    }
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      remove(store, resolvedKey, options)
      return { found: false, key: resolvedKey, value: fallback }
    }
    if (options.validate && !options.validate(record.value)) {
      remove(store, resolvedKey, options)
      return { found: false, key: resolvedKey, value: fallback }
    }

    return { found: true, key: resolvedKey, value: record.value }
  } catch (error) {
    report(options, error)
    remove(store, resolvedKey, options)
    return { found: false, key: resolvedKey, value: fallback }
  }
}

export function writeStored(key, value, fallback, options = {}) {
  const store = availableStorage(options.storage ?? (() => localStorage))
  const resolvedKey = durableKey(key, options)
  if (!store) return false

  if (equal(value, fallback) || value === undefined) {
    remove(store, resolvedKey, options)
    return true
  }

  const version = Number.isFinite(options.version) ? options.version : 1
  const record = {
    value,
    version,
    ...(options.ttl ? { expiresAt: Date.now() + Math.max(0, options.ttl) } : {})
  }

  try {
    store.setItem(resolvedKey, JSON.stringify(record))
    return true
  } catch (error) {
    report(options, error)
    return false
  }
}

export function removeStored(key, options = {}) {
  remove(
    availableStorage(options.storage ?? (() => localStorage)),
    durableKey(key, options),
    options
  )
}

export function subscribeStored(key, listener, options = {}) {
  if (typeof window === 'undefined') return () => {}
  const resolvedKey = durableKey(key, options)
  const store = availableStorage(options.storage ?? (() => localStorage))

  function onStorage(event) {
    if (event.key !== resolvedKey || (store && event.storageArea !== store)) {
      return
    }
    listener()
  }

  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

export function readQuery(key, fallback, options = {}) {
  if (typeof window === 'undefined') return fallback
  const raw = new URLSearchParams(window.location.search).get(key)
  if (raw == null || raw === '') return fallback

  try {
    const value = options.parse ? options.parse(raw) : parseLike(raw, fallback)
    return options.validate && !options.validate(value) ? fallback : value
  } catch {
    return fallback
  }
}

export function writeQuery(key, value, fallback, options = {}) {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  const previous = url.toString()

  if (value == null || value === '' || equal(value, fallback)) {
    url.searchParams.delete(key)
  } else {
    const serialized = options.serialize
      ? options.serialize(value)
      : serializeQuery(value)
    if (serialized == null || serialized === '') url.searchParams.delete(key)
    else url.searchParams.set(key, serialized)
  }

  const next = url.toString()
  if (next === previous) return false
  const replace = options.history === 'replace' || options.replace === true

  if (options.navigate) {
    options.navigate(`${url.pathname}${url.search}${url.hash}`, { replace })
  } else {
    window.history[replace ? 'replaceState' : 'pushState'](
      window.history.state,
      '',
      next
    )
  }
  window.dispatchEvent(new CustomEvent(queryEvent, { detail: { key } }))
  return true
}

export function subscribeQuery(key, listener) {
  if (typeof window === 'undefined') return () => {}
  const onPopState = () => listener()
  const onQuery = (event) => {
    if (!event.detail?.key || event.detail.key === key) listener()
  }
  window.addEventListener('popstate', onPopState)
  window.addEventListener(queryEvent, onQuery)
  return () => {
    window.removeEventListener('popstate', onPopState)
    window.removeEventListener(queryEvent, onQuery)
  }
}

export function readDraft(key, options = {}) {
  const result = readStored(key, null, {
    namespace: options.namespace || 'draft',
    ...options,
    validate(record) {
      return (
        record &&
        typeof record === 'object' &&
        Number.isFinite(record.savedAt) &&
        (!options.validate || options.validate(record.data))
      )
    }
  })
  return result.found ? result.value : null
}

export function writeDraft(key, data, options = {}) {
  if ((options.isEmpty || empty)(data)) {
    clearDraft(key, options)
    return null
  }
  const record = { data: clone(data), savedAt: Date.now() }
  const written = writeStored(key, record, null, {
    namespace: options.namespace || 'draft',
    ttl: options.ttl ?? 24 * 60 * 60 * 1000,
    ...options
  })
  return written ? record : null
}

export function clearDraft(key, options = {}) {
  removeStored(key, { namespace: options.namespace || 'draft', ...options })
}

export function readScroll(key, options = {}) {
  return readStored(key, null, {
    namespace: options.namespace || 'scroll',
    storage: options.storage ?? (() => sessionStorage),
    ...options,
    validate(value) {
      return (
        value &&
        Number.isFinite(value.x) &&
        Number.isFinite(value.y) &&
        (!options.validate || options.validate(value))
      )
    }
  }).value
}

export function writeScroll(key, value, options = {}) {
  return writeStored(key, value, null, {
    namespace: options.namespace || 'scroll',
    storage: options.storage ?? (() => sessionStorage),
    ...options
  })
}

export function equal(left, right) {
  if (Object.is(left, right)) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function clone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // Fall through for browser values that cannot be cloned.
    }
  }
  return JSON.parse(JSON.stringify(value))
}

export function empty(value) {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'number') return false
  if (typeof value === 'boolean') return value === false
  if (value instanceof Date) return Number.isNaN(value.getTime())
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.values(value).every(empty)
  return false
}

function parseLike(raw, fallback) {
  if (typeof fallback === 'number') {
    const number = Number(raw)
    return Number.isFinite(number) ? number : fallback
  }
  if (typeof fallback === 'boolean') {
    if (raw === 'true' || raw === '1') return true
    if (raw === 'false' || raw === '0') return false
    return fallback
  }
  if (Array.isArray(fallback) || (fallback && typeof fallback === 'object')) {
    return JSON.parse(raw)
  }
  return raw
}

function serializeQuery(value) {
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
