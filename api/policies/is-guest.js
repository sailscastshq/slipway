const authenticateRequest = require('../lib/authenticate-request')

module.exports = async function (req, res, proceed) {
  if (!(await authenticateRequest(req, { bearer: false }))) return proceed()
  return res.redirect('/')
}
