const store = require('../../lib/app-appearance-store')
module.exports = {
  friendlyName: 'View public app logo',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    slot: { type: 'string', isIn: ['light', 'dark'], required: true }
  },
  exits: {
    success: { responseType: 'appAppearanceLogo' },
    notFound: { statusCode: 404 }
  },
  fn: async function ({ projectSlug, environmentSlug, appSlug, slot }) {
    const { app } =
      await require('../../lib/app-appearance-access').publicBearing({
        req: this.req,
        projectSlug,
        environmentSlug,
        appSlug
      })
    return (await store.read(app))[slot === 'dark' ? 'logoDark' : 'logoLight']
  }
}
