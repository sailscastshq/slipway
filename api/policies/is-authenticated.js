const authenticateRequest = require('../lib/authenticate-request')

module.exports = async function (req, res, proceed) {
  const user = await authenticateRequest(req)
  if (user) {
    if (
      !user.team &&
      !/^\/(teams(?:\/|$)|switch-team$|settings(?:\/profile)?$|profile$|logout$|api\/v1\/cli\/logout$)/.test(
        req.path
      )
    ) {
      if (req.path.startsWith('/api/'))
        return res
          .status(403)
          .json({ message: 'Join or create a team before continuing.' })
      return res.redirect('/teams/create')
    }
    return proceed()
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    })
  }
  return res.redirect('/login')
}
