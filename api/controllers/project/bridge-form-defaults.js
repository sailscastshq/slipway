module.exports = {
  friendlyName: 'Get Bridge form defaults',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' },
    modelIdentity: { type: 'string', required: true },
    surface: { type: 'string', isIn: ['create', 'edit'], defaultsTo: 'create' },
    recordId: { type: 'string' },
    dependencies: { type: 'string', maxLength: 4000, defaultsTo: '{}' }
  },
  exits: {
    badRequest: { responseType: 'badRequest' },
    forbidden: { statusCode: 403 },
    reauthenticate: { responseType: 'bridgeReauthenticate' }
  },
  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    surface,
    recordId,
    dependencies
  }) {
    this.res.set('Cache-Control', 'no-store')
    try {
      if (surface === 'edit' && !recordId) throw new Error('Missing record')
      const { app, environment, actor } =
        await sails.helpers.bridge.resolveRequest.with({
          req: this.req,
          projectSlug: slug,
          environmentSlug: envSlug,
          ...(appSlug ? { appSlug } : {}),
          requiredRole: 'editor',
          requireRunning: true
        })
      const loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        actor,
        action: surface === 'edit' ? 'update' : 'create',
        ...(surface === 'edit' ? { recordId } : {})
      })
      const provider = loaded.resource.defaultsProvider
      const values = JSON.parse(dependencies)
      if (
        !provider ||
        !values ||
        typeof values !== 'object' ||
        Array.isArray(values) ||
        Object.keys(values).some(
          (name) => !provider.dependsOn.includes(name)
        ) ||
        [...provider.dependsOn, ...provider.fields].some(
          (name) => !loaded.resource[surface].includes(name)
        )
      )
        throw new Error('Unavailable defaults')
      return await sails.helpers.bridge.loadFormDefaults.with({
        containerName: app.containerName,
        environmentId: environment.id,
        resource: loaded.resource,
        actor,
        surface,
        ...(surface === 'edit' ? { recordId: loaded.recordId } : {}),
        values
      })
    } catch (error) {
      if (['forbidden', 'BRIDGE_ACTION_NOT_ALLOWED'].includes(error.code))
        throw 'forbidden'
      if (error.code === 'reauthenticate')
        throw { reauthenticate: error.raw || error }
      throw {
        badRequest: {
          error:
            'Suggested values are unavailable. You can enter them manually.'
        }
      }
    }
  }
}
