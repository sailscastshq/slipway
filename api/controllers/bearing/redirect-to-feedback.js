module.exports = {
  friendlyName: 'Redirect to public Bearing feedback',

  description:
    'Make the app-owned Bearing namespace resolve to its default feedback surface.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },

  exits: {
    success: { responseType: 'redirect' },
    notFound: { statusCode: 404 }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug }) {
    let resolved
    try {
      resolved = await sails.helpers.bearing.resolvePublicRequest.with({
        req: this.req,
        projectSlug,
        environmentSlug,
        appSlug
      })
    } catch {
      throw 'notFound'
    }

    return `${resolved.publicBasePath}/feedback`
  }
}
