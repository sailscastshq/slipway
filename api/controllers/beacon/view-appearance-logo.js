module.exports = {
  friendlyName: 'View public Beacon logo',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    slot: { type: 'string', required: true, isIn: ['light', 'dark'] }
  },
  exits: {
    success: { responseType: 'appAppearanceLogo' },
    notFound: { statusCode: 404 }
  },
  fn: async function ({ slot, ...inputs }) {
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
    return (await require('../../lib/app-appearance-store').read(resolved.app))[
      slot === 'dark' ? 'logoDark' : 'logoLight'
    ]
  }
}
