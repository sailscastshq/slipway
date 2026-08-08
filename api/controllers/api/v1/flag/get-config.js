const crypto = require('crypto')

module.exports = {
  friendlyName: 'Get release flag config',

  description:
    'Return compiled boolean flag configuration to an authenticated deployed app.',

  inputs: {
    appId: { type: 'string', required: true }
  },

  exits: {
    success: { statusCode: 200 },
    unauthorized: { statusCode: 401 },
    notFound: { statusCode: 404 }
  },

  fn: async function ({ appId }) {
    const authHeader = this.req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw 'unauthorized'
    }
    const token = authHeader.slice(7)
    if (!token || !token.startsWith('stk_')) throw 'unauthorized'

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const environment = await Environment.findOne({
      telemetryTokenHash: tokenHash
    })
    if (!environment) throw 'unauthorized'

    const app = await App.findOne({ id: appId, environment: environment.id })
    if (!app) throw 'notFound'

    const flags = (
      await FeatureFlag.find({
        environment: environment.id,
        app: app.id
      }).sort('key ASC')
    ).map((flag) => sails.helpers.flag.present(flag))
    const compiled = flags.map((flag) => ({
      key: flag.key,
      enabled: flag.enabled,
      rolloutPercentage: flag.rolloutPercentage,
      targets: flag.targets,
      version: flag.version
    }))
    const bearingSpace = app.bearingEnabled
      ? await BearingSpace.findOne({ app: app.id })
      : null
    const capabilities = {
      bearing: bearingSpace
        ? {
            enabled: true,
            widgetEnabled: bearingSpace.widgetEnabled,
            routePrefix: normalizeRoutePrefix(app.routePath),
            side: bearingSpace.widgetSide,
            openingView: bearingSpace.widgetOpeningView,
            showUnread: bearingSpace.showUnread
          }
        : { enabled: false, widgetEnabled: false }
    }
    const version = crypto
      .createHash('sha256')
      .update(JSON.stringify({ flags: compiled, capabilities }))
      .digest('hex')
      .slice(0, 16)

    this.res.set('Cache-Control', 'private, no-store')
    return { version, flags: compiled, capabilities }
  }
}

function normalizeRoutePrefix(routePath) {
  if (!routePath || routePath === '/') return ''
  return `/${String(routePath).replace(/^\/+|\/+$/g, '')}`
}
