/**
 * is-authenticated
 *
 * @description :: Policy to check if user is authenticated.
 *                 Supports both session-based auth (browser) and
 *                 Bearer token auth (CLI).
 */

module.exports = async function (req, res, proceed) {
  // Check session-based authentication first (browser)
  if (req.session.userId) {
    return proceed()
  }

  // Check for Bearer token (CLI)
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

    // Hash the token to compare with stored hashes
    const crypto = require('crypto')
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

    // Look up the token in the database
    const cliToken = await CliToken.findOne({ token: hashedToken })

    if (cliToken) {
      // Update last used timestamp (fire and forget, but must call fetch to execute)
      CliToken.updateOne({ id: cliToken.id }).set({ lastUsedAt: new Date() }).fetch().catch(() => {})

      // Attach user ID to request for downstream use
      req.session.userId = cliToken.user

      return proceed()
    }
  }

  // Not authenticated
  // For API requests, return 401; for browser requests, redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    })
  }

  return res.redirect('/login')
}
