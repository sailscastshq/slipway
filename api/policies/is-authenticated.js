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

    // Check if this token exists in our CLI tokens map
    if (sails.cliTokens && sails.cliTokens.has(token)) {
      const userId = sails.cliTokens.get(token)

      // Attach user ID to request for downstream use
      req.session.userId = userId

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
