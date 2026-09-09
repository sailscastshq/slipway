// Identity mapping only: never inherit Bridge's email-verification requirement.
module.exports = async function resolveWakeIdentity(
  sails,
  req,
  onError = () => {}
) {
  const slipway = sails.config.slipway || {}
  const mapping = {
    model: 'user',
    sessionKey: 'userId',
    ...(slipway.bridge?.identity || {}),
    ...(slipway.identity || {}),
    ...(slipway.wake?.identity || {})
  }
  try {
    let identity
    if (mapping.helper) {
      if (
        typeof mapping.helper !== 'string' ||
        !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)*$/.test(mapping.helper)
      )
        throw new Error('invalid helper')
      const helper = mapping.helper
        .split('.')
        .reduce(
          (node, key) =>
            Object.prototype.hasOwnProperty.call(node || {}, key)
              ? node[key]
              : undefined,
          sails.helpers
        )
      if (typeof helper?.with !== 'function') throw new Error('missing helper')
      identity = await helper.with({ req })
      // Explicit null is authoritative. Never fall through to session identity.
    } else {
      const id = req.session?.[mapping.sessionKey]
      if (id === undefined || id === null || id === '') return null
      if (!validId(id)) throw new Error('invalid session identity')
      const model = sails.models?.[String(mapping.model).toLowerCase()]
      if (!model) throw new Error('missing identity model')
      identity = await model.findOne({ id })
    }
    if (identity == null) return null
    if (!validId(identity.id)) throw new Error('invalid identity')
    return { id: String(identity.id) }
  } catch {
    // Deliberately do not forward error details, credentials, or account data.
    try {
      onError('identity_unavailable')
    } catch {
      /* diagnostics cannot break the app */
    }
    return null
  }
}
function validId(value) {
  return (
    (typeof value === 'string' ||
      (typeof value === 'number' && Number.isSafeInteger(value))) &&
    String(value).length > 0 &&
    String(value).length <= 256 &&
    !/[\x00-\x1f\x7f]/.test(String(value))
  )
}
