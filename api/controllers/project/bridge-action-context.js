module.exports = {
  friendlyName: 'Get Bridge action context',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' },
    modelIdentity: { type: 'string', required: true },
    actionName: { type: 'string', required: true },
    recordId: { type: 'ref', required: true }
  },
  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    actionName,
    recordId
  }) {
    this.res.set('Cache-Control', 'no-store')
    try {
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
        action: actionName,
        actor,
        recordId
      })
      if (
        !loaded.actionDefinition ||
        loaded.actionDefinition.scope !== 'record'
      )
        throw new Error('Unavailable action')
      const context = await sails.helpers.bridge.loadActionContext.with({
        containerName: app.containerName,
        resource: loaded.resource,
        action: loaded.actionDefinition,
        actor,
        recordId: loaded.recordId
      })
      return { action: context.action, conditionToken: context.conditionToken }
    } catch (error) {
      return this.res.status(409).json({
        error: error.code?.startsWith('BRIDGE_ACTION_CONTEXT_')
          ? error.message
          : 'This action is no longer available. Refresh the record and try again.'
      })
    }
  }
}
