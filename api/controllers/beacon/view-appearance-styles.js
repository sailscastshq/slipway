const { css } = require('../../lib/app-appearance')
module.exports = {
  friendlyName: 'View public Beacon appearance',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },
  exits: { notFound: { statusCode: 404 } },
  fn: async function (inputs) {
    let resolved
    try {
      resolved = await sails.helpers.beacon.resolvePublicRequest.with({
        req: this.req,
        ...inputs
      })
    } catch (error) {
      if (error.code === 'notFound') throw 'notFound'
      throw error
    }
    this.res.set('Content-Type', 'text/css; charset=utf-8')
    this.res.set('Cache-Control', 'private, no-store')
    this.res.set('X-Content-Type-Options', 'nosniff')
    return css(resolved.appearance, ':root')
  }
}
