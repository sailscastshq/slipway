/**
 * is-authenticated-or-setup
 *
 * For routes that require authentication but should redirect to /setup
 * if Slipway isn't configured yet (no genesis user).
 *
 * Flow:
 * 1. If setup not complete → redirect to /setup
 * 2. If not logged in → redirect to /login
 * 3. Otherwise → proceed
 */
module.exports = async function (req, res, proceed) {
  // First check: Is Slipway set up?
  if (!sails.config.custom.slipwayIsSetup) {
    // Redirect to setup - this takes priority over auth
    if (req.wantsJSON) {
      return res.status(503).json({ message: 'Slipway requires initial setup.' })
    }
    return res.redirect('/setup')
  }

  // Second check: Is user logged in?
  if (!req.session.userId) {
    if (req.wantsJSON) {
      return res.unauthorized()
    }
    return res.redirect('/login')
  }

  // User is authenticated
  return proceed()
}
