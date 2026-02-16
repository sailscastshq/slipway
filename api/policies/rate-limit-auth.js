const rateLimit = require('express-rate-limit')

// Strict limiter for login and reset-password: 5 attempts per 15 minutes
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
})

// Stricter limiter for forgot-password: 3 attempts per 15 minutes
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
})

function rateLimitHandler(req, res) {
  // Use Inertia's validation error pattern so the message shows inline in the form
  // Each form checks different error keys: login checks login/email, reset checks password
  const errorKeys = {
    'auth/login': 'login',
    'auth/forgot-password': 'email',
    'auth/reset-password': 'password'
  }
  const errorKey = errorKeys[req.options.action] || 'email'
  req.session.errors = { [errorKey]: ['Too many attempts. Please try again later.'] }
  return res.redirect(303, req.get('Referrer') || '/')
}

module.exports = function (req, res, next) {
  if (req.options.action === 'auth/forgot-password') {
    return forgotPasswordLimiter(req, res, next)
  }
  return standardLimiter(req, res, next)
}
