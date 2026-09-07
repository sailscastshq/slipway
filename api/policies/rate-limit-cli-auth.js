const rateLimit = require('express-rate-limit')
const options = {
  // Virtual/socket requests without an IP share one conservative quota.
  keyGenerator: (req) =>
    rateLimit.ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  handler: (_req, res) =>
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many CLI authorization requests. Try again later.'
    })
}
const issueLimiter = rateLimit({
  ...options,
  windowMs: 15 * 60 * 1000,
  limit: 20
})
const pollLimiter = rateLimit({ ...options, windowMs: 60 * 1000, limit: 300 })
module.exports = function (req, res, next) {
  return (
    req.options.action === 'api/v1/cli/init-auth' ? issueLimiter : pollLimiter
  )(req, res, next)
}
