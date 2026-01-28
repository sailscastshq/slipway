/**
 * is-setup-allowed
 *
 * Prevents access to /setup and /register routes when Slipway is already configured.
 * Only allows access when no genesis user exists (initial setup needed).
 */
module.exports = async function (req, res, proceed) {
  // Check if Slipway is already set up (set in bootstrap.js)
  if (sails.config.custom.slipwayIsSetup) {
    // Slipway is configured, don't allow access to setup/register
    if (req.wantsJSON) {
      return res.forbidden({ message: 'Slipway is already configured.' })
    }
    return res.redirect('/')
  }

  // Slipway needs setup, allow access
  return proceed()
}
