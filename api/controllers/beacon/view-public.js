module.exports = {
  friendlyName: 'View public Beacon page',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },
  exits: {
    success: { responseType: 'inertia' },
    notFound: { statusCode: 404 }
  },
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
    this.res.set('Cache-Control', 'private, no-store')
    return {
      page: 'beacon/public',
      props: {
        hostAssetBasePath: resolved.hostAssetBasePath,
        appearance: {
          ...resolved.appearance,
          stylesheet: `${resolved.publicBasePath}/_/appearance.css`
        },
        app: {
          name: resolved.appearance.displayName,
          homePath: resolved.homePath
        },
        availability: {
          status: 'unknown',
          lastCheckedAt: null,
          lastSuccessAt: null,
          incidents: []
        }
      }
    }
  }
}
