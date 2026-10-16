module.exports = {
  friendlyName: 'Get Bridge action options',
  exits: {
    badRequest: { responseType: 'badRequest' },
    forbidden: { statusCode: 403 }
  },
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' },
    modelIdentity: { type: 'string', required: true },
    actionName: { type: 'string', required: true },
    fieldName: { type: 'string', required: true },
    recordId: { type: 'ref', required: true },
    conditionToken: { type: 'string', maxLength: 512 },
    q: { type: 'string', defaultsTo: '', maxLength: 100 },
    dependencies: { type: 'string', defaultsTo: '{}', maxLength: 4000 }
  },
  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    actionName,
    fieldName,
    recordId,
    conditionToken,
    q,
    dependencies
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
      const { action } = await sails.helpers.bridge.loadActionContext.with({
        containerName: app.containerName,
        resource: loaded.resource,
        action: loaded.actionDefinition,
        actor,
        recordId: loaded.recordId,
        conditionToken,
        verify: true
      })
      const attribute = action.fields?.[fieldName]
      if (!attribute?.field?.optionsProvider)
        throw new Error('Unavailable field')
      const names = [
        ...new Set([
          ...attribute.field.optionsProvider.dependsOn,
          ...Object.keys(attribute.visibleWhen || {})
            .filter((p) => p.startsWith('form.'))
            .map((p) => p.slice(5))
        ])
      ]
      const raw = JSON.parse(dependencies)
      const values = await sails.helpers.bridge.allowResourceValues.with({
        values: raw,
        resource: {
          identity: loaded.resource.identity,
          primaryKey: '__action',
          create: names,
          attributes: Object.fromEntries(
            names.map((name) => [name, action.fields[name]])
          ),
          associations: []
        },
        surface: 'create'
      })
      if (
        !sails.helpers.bridge.matchesActionConditions.with({
          condition: attribute.visibleWhen,
          form: values,
          scope: 'form'
        })
      )
        throw new Error('Unavailable field')
      return await sails.helpers.bridge.searchActionOptions.with({
        containerName: app.containerName,
        action,
        fieldName,
        actor,
        recordId: loaded.recordId,
        values,
        q
      })
    } catch (error) {
      if (error.code === 'forbidden') throw 'forbidden'
      throw {
        badRequest: {
          error:
            'These options are unavailable. Reopen the action and try again.'
        }
      }
    }
  }
}
