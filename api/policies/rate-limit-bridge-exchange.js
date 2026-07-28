const rateLimit = require('express-rate-limit')

const bridgeExchangeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  handler: function (_req, res) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many Bridge identity exchanges. Try again in a moment.'
    })
  }
})

module.exports = function (req, res, proceed) {
  if (sails.config.environment === 'test') {
    return proceed()
  }
  return bridgeExchangeLimiter(req, res, proceed)
}
