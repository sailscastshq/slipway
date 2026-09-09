// The support identity is request-local. Never give express-session an ID it can
// persist, and never copy roles, team selection or credentials from the operator.
module.exports = function overlaySession(req, envelope, values) {
  if (!req.session || !req.session.cookie)
    throw Error('A host session middleware is required.')
  const original = req.session
  const cookie = Object.assign(
    Object.create(Object.getPrototypeOf(original.cookie)),
    original.cookie
  )
  req.sessionID = undefined
  req.session = {
    ...values,
    cookie,
    touch() {
      return this
    },
    save(callback) {
      callback?.()
    },
    reload(callback) {
      callback?.(Error('Support sessions cannot reload the normal session.'))
    },
    regenerate(callback) {
      callback?.(Error('Support sessions cannot change identity.'))
    },
    destroy(callback) {
      callback?.(Error('Stop the support view to end this identity.'))
    }
  }
  delete req.auth
  delete req.me
  delete req.user
  Object.defineProperty(req, '_slipwaySupportSession', {
    value: Object.freeze(
      Object.fromEntries(
        ['id', 'appId', 'actor', 'subject', 'reason', 'mode', 'expiresAt'].map(
          (key) => [key, envelope[key]]
        )
      )
    ),
    writable: false
  })
  return original
}
