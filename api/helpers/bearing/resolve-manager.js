module.exports = {
  friendlyName: 'Resolve Bearing manager',

  description:
    'Resolve an app and require a Slipway owner or administrator from its team.',

  inputs: {
    req: { type: 'ref', required: true },
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },

  exits: {
    success: { outputType: 'ref' },
    forbidden: {},
    notFound: {}
  },

  fn: async function ({ req, projectSlug, environmentSlug, appSlug }) {
    // Compatibility entry point for existing Bearing callers.
    try {
      return await sails.helpers.app.resolveManager.with({
        req,
        projectSlug,
        environmentSlug,
        appSlug
      })
    } catch (error) {
      if (['forbidden', 'notFound'].includes(error.code)) throw error.code
      throw error
    }
  }
}
