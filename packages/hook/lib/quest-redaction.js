const { sanitizeQuestDiagnostic } = require('./quest-diagnostics')

const SENSITIVE_KEY =
  /password|passwd|secret|token|api.?key|credential|private.?key/i
const REDACTED = '<redacted>'
const UNAVAILABLE = '<unavailable: sensitive input redaction>'
const MAX_RUNS = 32
const MAX_SECRET_BYTES = 64 * 1024
const MAX_PATTERNS = 256
const MAX_NODES = 4096
const MAX_TEXT_BYTES = 1024 * 1024
const terminal = new Set(['completed', 'failed', 'skipped', 'cancelled'])
// Neither raw matching values nor this cache are part of a run's public data.
const stores = new WeakMap()
const contexts = new WeakMap()
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const isSensitive = (name, field) =>
  SENSITIVE_KEY.test(name) ||
  field?.sensitive === true ||
  field?.protect === true ||
  field?.secret === true

// Diagnostic tails do not report whether their left edge was clipped. Detect
// a surviving suffix of a known value in linear time, bounded by its length.
function hasSecretSuffixAtStart(text, secret) {
  if (text.startsWith(secret)) return false
  const prefix = text.slice(0, secret.length - 1)
  if (!prefix) return false
  const fallback = new Uint32Array(prefix.length)
  for (let index = 1, match = 0; index < prefix.length; index++) {
    while (match && prefix[index] !== prefix[match]) match = fallback[match - 1]
    if (prefix[index] === prefix[match]) match++
    fallback[index] = match
  }
  let match = 0
  for (let index = 1; index < secret.length; index++) {
    while (
      match &&
      (match === prefix.length || secret[index] !== prefix[match])
    )
      match = fallback[match - 1]
    if (secret[index] === prefix[match]) match++
  }
  return match > 0
}

function createQuestRedactor(
  inputs,
  metadata,
  previous,
  metadataAvailable = true
) {
  const prior = contexts.get(previous)
  const patterns = new Set(prior?.patterns || [])
  const scalars = new Set(prior?.scalars || [])
  const names = new Set(prior?.names || [])
  let available = metadataAvailable && prior?.available !== false
  let bytes = prior?.bytes || 0
  let nodes = 0
  let snapshot = prior?.snapshot || {}
  const seen = new Set()
  const add = (value) => {
    if (!value || patterns.has(value)) return
    bytes += Buffer.byteLength(value)
    if (bytes > MAX_SECRET_BYTES || patterns.size >= MAX_PATTERNS)
      throw new Error('Redaction budget exceeded')
    patterns.add(value)
  }
  const collect = (value, secret = false, depth = 0) => {
    if (++nodes > MAX_NODES || depth > 8)
      throw new Error('Redaction traversal exceeded')
    if (value === undefined) return
    if (
      value === null ||
      ['string', 'number', 'boolean'].includes(typeof value)
    ) {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new Error('Unsupported redaction value')
      if (secret) {
        scalars.add(value)
        add(String(value))
        // Upstream completed diagnostic tails trim their boundary whitespace.
        if (typeof value === 'string') {
          add(value.trim())
          for (const line of value.split(/\r?\n/)) add(line)
          // JSON logging is a common representation of nested input values.
          add(JSON.stringify(value).slice(1, -1))
        }
      }
      return
    }
    if (
      !value ||
      typeof value !== 'object' ||
      seen.has(value) ||
      (!Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    )
      throw new Error('Unsupported redaction value')
    seen.add(value)
    for (const [key, item] of Object.entries(value)) {
      if (secret && !Array.isArray(value)) add(key)
      collect(item, secret || SENSITIVE_KEY.test(key), depth + 1)
    }
    seen.delete(value)
  }
  try {
    // Environment values need the same streaming boundary protection as
    // declared inputs, before any live snapshot or receipt is retained.
    for (const [name, value] of Object.entries(process.env))
      if (SENSITIVE_KEY.test(name) && typeof value === 'string')
        collect(value, true)
    const fields = metadata?.inputs || {}
    const sources = metadata?.scheduledInputs?.fields || {}
    const sourceValues = metadata?.scheduledInputs?.values || {}
    const values = inputs || {}
    const fieldNames = new Set([
      ...Object.keys(fields),
      ...Object.keys(sources),
      ...Object.keys(values)
    ])
    if (fieldNames.size > MAX_NODES)
      throw new Error('Redaction metadata exceeded')
    for (const name of fieldNames) {
      const field = fields[name]
      const source = sources[name]
      const secret =
        names.has(name) || isSensitive(name, field) || isSensitive(name, source)
      if (secret) names.add(name)
      if (own(values, name) && values[name] !== undefined)
        collect(values[name], secret)
      else if (!prior) {
        if (own(field || {}, 'defaultsTo')) collect(field.defaultsTo, secret)
        if (own(sourceValues, name)) collect(sourceValues[name], secret)
        // An explicitly omitted field has no value to redact. A hidden source
        // default/configured value cannot be recovered from public metadata.
        if (
          secret &&
          source &&
          source.source !== 'omitted' &&
          !own(sourceValues, name) &&
          !(
            source.source === 'schema_default' && own(field || {}, 'defaultsTo')
          )
        )
          available = false
      }
    }
  } catch {
    available = false
  }
  // Fail closed without retaining a partial or oversized set of raw secrets.
  if (!available) {
    patterns.clear()
    scalars.clear()
    bytes = 0
    snapshot = {}
  }
  const ordered = [...patterns].sort((a, b) => b.length - a.length)
  const pattern = ordered.length
    ? new RegExp(
        ordered
          .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'g'
      )
    : null
  const redactor = {
    available,
    value(value) {
      return scalars.has(value) ? REDACTED : value
    },
    text(value, options = {}) {
      if (typeof value !== 'string') return ''
      if (
        !available ||
        Buffer.byteLength(value) > MAX_TEXT_BYTES ||
        (options.truncated && patterns.size) ||
        (options.tail &&
          patterns.size &&
          (value.startsWith('\ufffd') ||
            ordered.some((secret) => hasSecretSuffixAtStart(value, secret))))
      )
        return UNAVAILABLE
      let clean = value
      if (options.live) {
        // Hold an unfinished line and any suffix matching a declared secret
        // prefix. Chunk boundaries never make partial secret text public.
        clean = clean.slice(0, clean.lastIndexOf('\n') + 1)
        for (const secret of ordered) {
          const prefix = secret.slice(0, -1)
          const fallback = new Uint32Array(prefix.length)
          for (let index = 1, match = 0; index < prefix.length; index++) {
            while (match && prefix[index] !== prefix[match])
              match = fallback[match - 1]
            if (prefix[index] === prefix[match]) match++
            fallback[index] = match
          }
          let match = 0
          for (
            let index = Math.max(0, clean.length - prefix.length);
            index < clean.length;
            index++
          ) {
            const character = clean[index]
            while (
              match &&
              (match === prefix.length || character !== prefix[match])
            )
              match = fallback[match - 1]
            if (character === prefix[match]) match++
          }
          if (match) clean = clean.slice(0, -match) + REDACTED
        }
      }
      // Redact the fully assembled tail, before either sanitizer or byte trim
      // can split a declared value across an output boundary.
      if (pattern) clean = clean.replace(pattern, () => REDACTED)
      return sanitizeQuestDiagnostic(clean, options)
    },
    inputs(value, sanitize) {
      if (!available) return {}
      if (value === undefined) return snapshot
      try {
        if (
          !value ||
          typeof value !== 'object' ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(value))
        )
          return {}
        // Schema field names are transport metadata, unlike echoed business
        // object keys. Keep them intact even when a secret equals a field name.
        const clean = Object.fromEntries(
          Object.entries(value).map(([name, item]) => [
            name,
            names.has(name) ? REDACTED : sanitize(item)
          ])
        )
        snapshot =
          Buffer.byteLength(JSON.stringify(clean)) <= 16 * 1024 ? clean : {}
        contexts.get(redactor).snapshot = snapshot
        return snapshot
      } catch {
        return {}
      }
    }
  }
  contexts.set(redactor, {
    patterns,
    scalars,
    names,
    available,
    bytes,
    snapshot
  })
  return redactor
}

function questRedactor(sails, data, state) {
  let store
  if (sails && typeof sails === 'object') {
    store = stores.get(sails)
    if (!store) stores.set(sails, (store = new Map()))
  }
  const identified =
    typeof data.runId === 'string' &&
    data.runId.length <= 256 &&
    typeof data.runtimeId === 'string' &&
    data.runtimeId.length <= 256
  const key = identified ? JSON.stringify([data.runtimeId, data.runId]) : null
  const previous = key && store?.get(key)
  let metadata
  try {
    metadata = sails?.quest?.metadata?.(data.name)
    if (Array.isArray(metadata))
      metadata = metadata.find((job) => job.name === data.name)
  } catch {
    // Losing a previously known schema must not lose its redaction context.
    if (previous) return previous.redactor
    return createQuestRedactor(undefined, undefined, undefined, false)
  }
  const redactor = createQuestRedactor(
    data.inputs,
    metadata,
    previous?.redactor
  )
  if (key && store) {
    store.set(key, {
      redactor,
      state: terminal.has(previous?.state) ? previous.state : state
    })
    if (store.size > MAX_RUNS) {
      const completed = [...store].find(([, item]) => terminal.has(item.state))
      store.delete(completed?.[0] || store.keys().next().value)
    }
  }
  return redactor
}

function forgetQuestRedactor(sails, runtimeId, runId) {
  stores.get(sails)?.delete(JSON.stringify([runtimeId, runId]))
}

module.exports = {
  createQuestRedactor,
  questRedactor,
  forgetQuestRedactor,
  SENSITIVE_KEY,
  UNAVAILABLE
}
