const authenticateRequest = require('../lib/authenticate-request')

module.exports = async function (req, res, proceed) {
  if (await authenticateRequest(req)) return proceed()
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    })
  }
  return res.redirect('/login')
}
