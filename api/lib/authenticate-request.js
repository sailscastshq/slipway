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
    if (
      token?.expiresAt &&
      !(new Date(token.expiresAt).getTime() > Date.now())
    ) {
      return null
    }
    const user = token ? await User.findOne({ id: token.user }) : null
    if (!user || (token.authVersion || '') !== (user.authVersion || ''))
      return null
    req.auth = {
      userId: user.id,
      tokenId: token.id,
      method: 'bearer',
      teamId: token.team,
      authVersion: user.authVersion || ''
    }
    if (
      !token.team ||
      !(await TeamMembership.findOne({
        user: user.id,
        team: token.team,
        status: 'active'
      }))
    ) {
      delete req.auth
      return null
    }
    CliToken.updateOne(token.id)
      .set({ lastUsedAt: new Date() })
      .catch(() => {})
    return User.forRequest(req)
  }

  const user = req.session?.userId
    ? await User.findOne({ id: req.session.userId })
    : null
  if (!user || (req.session.authVersion || '') !== (user.authVersion || '')) {
    if (req.session) delete req.session.userId
    return null
  }
  let activeTeamId = req.session.activeTeamId || user.team
  if (
    !(
      activeTeamId &&
      (await TeamMembership.findOne({
        user: user.id,
        team: activeTeamId,
        status: 'active'
      }))
    )
  ) {
    const [fallback] = await TeamMembership.find({
      user: user.id,
      status: 'active'
    })
      .sort('id ASC')
      .limit(1)
    activeTeamId = fallback?.team || null
  }
  req.session.activeTeamId = activeTeamId
  req.auth = {
    teamId: activeTeamId,
    userId: user.id,
    method: 'session',
    sessionId: req.sessionID,
    authVersion: user.authVersion || ''
  }
  return User.forRequest(req)
}
