const { css } = require('../../lib/app-appearance')
module.exports = {
  friendlyName: 'View app appearance stylesheet',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    widget: { type: 'boolean', defaultsTo: false }
  },
  exits: { notFound: { statusCode: 404 } },
  fn: async function ({ projectSlug, environmentSlug, appSlug, widget }) {
    const resolved =
      await require('../../lib/app-appearance-access').publicBearing({
        req: this.req,
        projectSlug,
        environmentSlug,
        appSlug
      })
    this.res.set('Content-Type', 'text/css; charset=utf-8')
    this.res.set('Cache-Control', 'private, no-store')
    this.res.set('X-Content-Type-Options', 'nosniff')
    return css(resolved.appearance, widget ? ':host' : ':root')
  }
}
