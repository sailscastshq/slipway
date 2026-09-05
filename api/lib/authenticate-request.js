const crypto = require('node:crypto')

/** Authenticate one request without converting a bearer token into a session. */
module.exports = async function authenticateRequest(
  req,
  { bearer = true } = {}
) {
  delete req.auth
  const authorization = req.headers?.authorization
  if (authorization) {
    if (!bearer || !authorization.startsWith('Bearer ')) return null
    const raw = authorization.slice(7).replace(/^sl_/, '')
    if (!raw) return null
    const token = await CliToken.findOne({
      token: crypto.createHash('sha256').update(raw).digest('hex')
    })
    if (token?.expiresAt && !(new Date(token.expiresAt).getTime() > Date.now())) {
      return null
    }
    const user = token ? await User.findOne({ id: token.user }) : null
    if (!user) return null
    req.auth = { userId: user.id, tokenId: token.id, method: 'bearer' }
    CliToken.updateOne(token.id)
      .set({ lastUsedAt: new Date() })
      .catch(() => {})
    return user
  }

  const user = req.session?.userId
    ? await User.findOne({ id: req.session.userId })
    : null
  if (!user) {
    if (req.session) delete req.session.userId
    return null
  }
  req.auth = { userId: user.id, method: 'session', sessionId: req.sessionID }
  return user
}
