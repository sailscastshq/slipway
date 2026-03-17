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
  // Check if this is an Inertia request (browser with Inertia)
  // Inertia requests should always redirect, not return JSON
  const isInertia = req.get('X-Inertia') === 'true'

  // Check if this is a pure API request (not Inertia, but wants JSON)
  const isPureApi = req.wantsJSON && !isInertia

  // First check: Is Slipway set up?
  if (!sails.config.custom.slipwayIsSetup) {
    if (isPureApi) {
      return res
        .status(503)
        .json({ message: 'Slipway requires initial setup.' })
    }
    return res.redirect('/setup')
  }

  // Second check: Is user logged in?
  if (!req.session.userId) {
    if (isPureApi) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      })
    }
    return res.redirect('/login')
  }

  // User is authenticated
  return proceed()
}
