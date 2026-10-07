const { StringDecoder } = require('node:string_decoder')
const HIDDEN = '[REDACTED]'
const sensitive =
  /password|secret|token|credential|authorization|encrypted|privatekey|accesskey|apikey|authversion/i
const configurationMaps = new Map([
  ['envVars', 'envVarMetadata'],
  ['secureEnvVars', 'envVarMetadata'],
  ['appEnvVars', 'appEnvVarMetadata'],
  ['globalEnvVars', 'globalEnvVarMetadata']
])
function isPublicUploadOrigin(name, value) {
  if (!/^(R2|S3|SPACES)_PUBLIC_URL$/.test(name)) return false
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}
const identifiers = new Set([
  'id',
  'slug',
  'status',
  'type',
  'kind',
  'version',
  'component',
  'environmentSlug',
  'projectSlug',
  'appSlug',
  'containerName',
  'containerId',
  'imageId',
  'imageReference',
  'commitHash',
  'branch',
  'internalHost',
  'database',
  'action',
  'resourceType',
  'key',
  '_csrf'
])
module.exports = {
  friendlyName: 'Redact diagnostic output',
  description:
    'Mask configuration and credential material before serialization.',
  sync: true,
  inputs: {
    value: { type: 'ref' },
    secrets: { type: 'ref', defaultsTo: [] }
  },
  exits: { success: { outputType: 'ref' } },
  fn: function ({ value, secrets }) {
    const redact = createRedactor()
    secrets.forEach((value) => redact.remember({ password: value }))
    return redact.protect(value)
  }
}
function publicValues(values, metadata = {}) {
  global.sails?.hooks?.secrets?.remember({
    envVars: values,
    envVarMetadata: metadata
  })
  return Object.fromEntries(
    Object.entries(values || {}).map(([key, value]) => [
      key,
      metadata[key]?.kind === 'plain' ? value : HIDDEN
    ])
  )
}
function preserveValues(values, current, renames = {}) {
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    !renames ||
    typeof renames !== 'object' ||
    Array.isArray(renames)
  )
    throw new Error('Invalid variable map.')
  const destinations = Object.values(renames)
  if (
    destinations.some((key) => typeof key !== 'string') ||
    new Set(destinations).size !== destinations.length
  )
    throw new Error('Invalid variable rename.')
  for (const [source, destination] of Object.entries(renames)) {
    if (
      !Object.hasOwn(current, source) ||
      !Object.hasOwn(values, destination) ||
      (destination !== source && Object.hasOwn(current, destination))
    )
      throw new Error('Invalid variable rename.')
  }
  const result = { ...values }
  const sources = Object.fromEntries(
    Object.entries(renames).map(([from, to]) => [to, from])
  )
  for (const [key, value] of Object.entries(result)) {
    if (value !== HIDDEN && value !== '[Managed external connection]') continue
    const source = sources[key] || key
    if (!Object.hasOwn(current, source))
      throw new Error(
        'A hidden variable cannot be copied to a new key. Rename it explicitly or provide a new value.'
      )
    if (sources[key] && Object.hasOwn(result, source))
      throw new Error('A renamed variable must remove its previous key.')
    result[key] = current[source]
  }
  return result
}
function createRedactor() {
  const variants = new Set()
  let bytes = 0
  let overflow = false
  let matcher = null
  let dirty = false
  function remember(record) {
    function add(value) {
      if (typeof value !== 'string' || value.length < 8 || value === HIDDEN)
        return
      if (value.length > 128 * 1024) {
        overflow = true
        return
      }
      for (const form of [
        ...value.split(/\r?\n/).filter((line) => line.length >= 8),
        value,
        encodeURIComponent(value),
        JSON.stringify(value).slice(1, -1),
        value.replace(
          /[&<>"']/g,
          (character) =>
            ({
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&#39;'
            }[character])
        ),
        Buffer.from(value).toString('base64'),
        Buffer.from(value).toString('base64url'),
        Buffer.from(value).toString('hex')
      ]) {
        if (variants.has(form)) continue
        if (
          bytes + Buffer.byteLength(form) > 4 * 1024 * 1024 ||
          variants.size >= 10000
        ) {
          overflow = true
          continue
        }
        variants.add(form)
        bytes += Buffer.byteLength(form)
        dirty = true
      }
    }
    function collect(value, force = false) {
      if (!value || typeof value !== 'object') {
        if (force) add(value)
        return
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => collect(entry, force))
        return
      }
      for (const [key, entry] of Object.entries(value)) {
        if (configurationMaps.has(key)) {
          const metadata = value[configurationMaps.get(key)] || {}
          if (entry && typeof entry === 'object')
            for (const [name, configured] of Object.entries(entry)) {
              // Public upload origins are intentionally sent to browsers in image
              // URLs. The environment map itself remains masked by publicValues.
              if (
                metadata[name]?.kind !== 'plain' &&
                !isPublicUploadOrigin(name, configured)
              )
                collect(configured, true)
            }
        } else if (key === 'env') collect(entry, true)
        else
          collect(entry, force || sensitive.test(key.replace(/[^a-z]/gi, '')))
      }
      if (value.key === 'globalEnvVars') {
        try {
          collect({
            envVars: JSON.parse(value.encryptedValue || value.value || '{}')
          })
        } catch {
          /* encrypted storage is not diagnostic data */
        }
      } else if (value.encryptedValue) {
        try {
          const configured = JSON.parse(value.encryptedValue)
          if (value.key === 'backupStorageConfig') {
            collect(configured)
            // These adapter credential names do not match the generic key test.
            collect(configured.key, true)
            collect(configured.accountKey, true)
          } else collect(configured, true)
        } catch {
          add(value.encryptedValue)
        }
      }
    }
    collect(record)
  }
  function text(value) {
    if (overflow)
      return '[Diagnostic output withheld: redaction capacity exceeded]'
    if (dirty) {
      matcher = new RegExp(
        [...variants]
          .sort((a, b) => b.length - a.length)
          .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'g'
      )
      dirty = false
    }
    let result = matcher ? value.replace(matcher, HIDDEN) : value
    return result
      .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/]*@)/gi, '$1[REDACTED]@')
      .replace(
        /([?&](?:password|secret|token|api[_-]?key|access[_-]?key|signature|credential|authorization|x-amz-[a-z-]+|x-goog-[a-z-]+)=)[^&#\s]*/gi,
        '$1[REDACTED]'
      )
      .replace(
        /(\b(?:password|secret|token|api[_-]?key|access[_-]?key|authorization)\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
        '$1[REDACTED]'
      )
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '$1 [REDACTED]')
  }
  function protect(value, seen = new WeakSet(), depth = 0) {
    if (typeof value === 'string') return text(value)
    if (!value || typeof value !== 'object') return value
    if (value instanceof Date) return value.toISOString()
    if (Buffer.isBuffer(value)) return text(value.toString('utf8'))
    if (depth > 30 || seen.has(value)) return '[Unavailable nested diagnostic]'
    seen.add(value)
    let result
    if (value instanceof Error)
      result = protect(
        {
          name: value.name,
          message: value.message,
          stack: value.stack,
          ...value
        },
        seen,
        depth + 1
      )
    else if (Array.isArray(value))
      result = value.map((entry) => protect(entry, seen, depth + 1))
    else {
      result = Object.create(null)
      for (const [key, entry] of Object.entries(value)) {
        if (
          key === 'errors' &&
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry)
        ) {
          // Inertia's validation map contains messages, not form values.
          result[key] = Object.fromEntries(
            Object.entries(entry).map(([field, message]) => [
              field,
              typeof message === 'string'
                ? text(message)
                : protect(message, seen, depth + 1)
            ])
          )
        } else if (key === 'deployTokens' && Array.isArray(entry))
          // This collection contains public token administration metadata, not
          // token values. Its credential-bearing children still get masked.
          result[key] = entry.map((token) => protect(token, seen, depth + 1))
        else if (typeof entry === 'boolean' && /^has[A-Z]/.test(key))
          result[key] = entry
        else if (configurationMaps.has(key))
          result[key] = publicValues(
            entry && typeof entry === 'object' ? entry : {},
            value[configurationMaps.get(key)]
          )
        else if (
          ['customDefinition', 'customRecovery', 'externalConnection'].includes(
            key
          ) ||
          sensitive.test(key.replace(/[^a-z]/gi, ''))
        )
          result[key] = entry == null || entry === '' ? entry : HIDDEN
        else if (identifiers.has(key) && typeof entry === 'string')
          result[key] = entry
        else result[key] = protect(entry, seen, depth + 1)
      }
    }
    seen.delete(value)
    return result
  }
  function stream() {
    let pending = ''
    let withheld = false
    const decoder = new StringDecoder('utf8')
    return {
      write(chunk) {
        let output = ''
        const decoded = Buffer.isBuffer(chunk)
          ? decoder.write(chunk)
          : String(chunk)
        for (const segment of decoded.split(/(?<=\n)/)) {
          if (!withheld) pending += segment
          if (pending.length > 65536) {
            output += '[Diagnostic line withheld: size limit exceeded]\n'
            pending = ''
            withheld = true
          }
          if (segment.endsWith('\n')) {
            if (!withheld) output += text(pending)
            pending = ''
            withheld = false
          }
        }
        return output
      },
      end() {
        const output = this.write(decoder.end()) + text(pending)
        pending = ''
        return output
      }
    }
  }
  return { remember, protect, text, stream }
}
module.exports._private = {
  HIDDEN,
  publicValues,
  preserveValues,
  createRedactor
}
