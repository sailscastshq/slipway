const store = require('../../lib/app-appearance-store')
module.exports = {
  friendlyName: 'View app appearance logo',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    slot: { type: 'string', isIn: ['light', 'dark'], required: true }
  },
  exits: {
    success: { responseType: 'appAppearanceLogo' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },
  fn: async function ({ slug, envSlug, appSlug, slot }) {
    const { app } = await require('../../lib/app-appearance-access').manager({
      req: this.req,
      projectSlug: slug,
      environmentSlug: envSlug,
      appSlug
    })
    return (await store.read(app))[slot === 'dark' ? 'logoDark' : 'logoLight']
  }
}
