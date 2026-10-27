const { css } = require('../../lib/app-appearance')
const store = require('../../lib/app-appearance-store')
module.exports = {
  friendlyName: 'View host Bridge appearance stylesheet',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },
  exits: {
    forbidden: { statusCode: 403 },
    notFound: { statusCode: 404 },
    reauthenticate: { responseType: 'bridgeReauthenticate' }
  },
  fn: async function ({ slug, envSlug, appSlug }) {
    const { app } = await require('../../lib/app-appearance-access').bridge({
      req: this.req,
      projectSlug: slug,
      environmentSlug: envSlug,
      appSlug
    })
    this.res.set('Content-Type', 'text/css; charset=utf-8')
    this.res.set('Cache-Control', 'private, no-store')
    this.res.set('X-Content-Type-Options', 'nosniff')
    return css(await store.resolve(app, ''))
  }
}
