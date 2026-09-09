const { normalizeRoutePrefix } = require('./bearing-widget')
module.exports = function installSupport(sails, runtime) {
  const config = sails.config.slipway?.bridge?.impersonation
  if (!config?.enabled) return
  const prefix = normalizeRoutePrefix(sails.config.slipway.bridge.routePath)
  if (
    Object.keys(sails.config.routes || {}).some((route) =>
      [...new Set(['', prefix])].some((base) =>
        route
          .replace(/^(?:GET|POST|ALL) /i, '')
          .startsWith(base + '/_slipway/bridge/impersonation')
      )
    )
  ) {
    config.enabled = false
    sails.log?.warn(
      'Support viewing routes conflict with application routes; support viewing is disabled.'
    )
    return
  }
  const middleware = sails.config.http?.middleware
  if (
    !middleware?.order?.includes('session') ||
    !middleware.order.includes('bodyParser')
  ) {
    config.enabled = false
    sails.log?.warn(
      'Support viewing requires the host session and body parser middleware.'
    )
    return
  }
  middleware.slipwaySupport = (req, res, next) => {
    if (!runtime()) return next()
    Promise.resolve(runtime().middleware(req, res, next)).catch(() => {
      if (!res.headersSent)
        res.status(403).send('Support viewing could not be verified.')
      else res.destroy()
    })
  }
  middleware.order.splice(
    middleware.order.indexOf('bodyParser') + 1,
    0,
    'slipwaySupport'
  )
}
