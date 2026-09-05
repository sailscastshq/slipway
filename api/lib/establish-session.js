/** Rotate identity, preserving no previous account or app-scoped privileges. */
module.exports = async function establishSession(req, user, { maxAge } = {}) {
  const previousSessionId = req.sessionID
  if (typeof req.session.regenerate === 'function') {
    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()))
    })
  } else {
    // Virtual request transport: emulate clearing the old session in place.
    for (const key of Object.keys(req.session)) {
      if (key !== 'cookie') delete req.session[key]
    }
  }
  if (previousSessionId) sails.sse?.revoke?.({ sessionId: previousSessionId })
  req.session.userId = user.id
  req.session.authVersion = user.authVersion || ''
  if (maxAge !== undefined && req.session.cookie)
    req.session.cookie.maxAge = maxAge
  req.auth = { userId: user.id, method: 'session', sessionId: req.sessionID }
}
