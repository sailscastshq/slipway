/**
 * Fingerprint only the runtime configuration that decides which datastore a
 * model uses. The digest stays inside the app container; no URL or credential
 * is sent to Slipway or the browser.
 */
module.exports = function fingerprintHelmDatastores(sailsApp) {
  const crypto = require('node:crypto')
  const seen = new WeakSet()
  function canonical(value) {
    if (value === undefined) return ['undefined']
    if (
      value === null ||
      ['string', 'number', 'boolean'].includes(typeof value)
    )
      return value
    if (typeof value === 'function') return ['function']
    if (Array.isArray(value)) return value.map(canonical)
    if (typeof value !== 'object' || seen.has(value))
      throw new Error('Unsupported datastore configuration shape')
    seen.add(value)
    const result = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
    seen.delete(value)
    return result
  }
  const config = sailsApp.config || {}
  const shape = canonical({
    environment: config.environment,
    datastores: config.datastores,
    models: {
      datastore: config.models?.datastore,
      connection: config.models?.connection
    }
  })
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex')
}
