module.exports = async function (req, res, proceed) {
  if (req.session.userId || req.session.bridgeAccessId) {
    return proceed()
  }

  if (req.wantsJSON && req.get('X-Inertia') !== 'true') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Bridge authentication required.'
    })
  }

  return res.redirect('/login')
}
