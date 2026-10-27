const store = require('../../lib/app-appearance-store')
module.exports = {
  friendlyName: 'View host Bridge app logo',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    slot: { type: 'string', isIn: ['light', 'dark'], required: true }
  },
  exits: {
    success: { responseType: 'appAppearanceLogo' },
    forbidden: { statusCode: 403 },
    notFound: { statusCode: 404 },
    reauthenticate: { responseType: 'bridgeReauthenticate' }
  },
  fn: async function ({ slug, envSlug, appSlug, slot }) {
    const { app } = await require('../../lib/app-appearance-access').bridge({
      req: this.req,
      projectSlug: slug,
      environmentSlug: envSlug,
      appSlug
    })
    return (await store.read(app))[slot === 'dark' ? 'logoDark' : 'logoLight']
  }
}
