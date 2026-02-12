module.exports = {
  friendlyName: 'Bulk destroy records',

  description: 'Delete multiple records from a Waterline model.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    model: {
      type: 'string',
      required: true
    },
    ids: {
      type: 'ref',
      required: true,
      description: 'Array of record IDs to delete (max 100)'
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function ({ projectSlug, environmentSlug, model: modelIdentity, ids }) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw { badRequest: 'ids must be a non-empty array.' }
    }

    if (ids.length > 100) {
      throw { badRequest: 'Maximum 100 IDs per bulk delete.' }
    }

    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveEnvironment(this.req, projectSlug, environmentSlug)
    } catch (err) {
      if (err === 'notFound') throw 'notFound'
      if (err === 'forbidden') throw 'forbidden'
      if (err === 'appNotRunning') throw { badRequest: 'App is not running.' }
      throw err
    }

    const { app, environment } = resolved

    const introspection = await sails.helpers.bridge.introspectModels(
      app.containerName,
      environment.id
    )

    if (introspection.error) {
      throw { badRequest: introspection.error }
    }

    const modelMeta = introspection.models[modelIdentity]
    if (!modelMeta) {
      throw { badRequest: `Model "${modelIdentity}" not found.` }
    }

    const idsJson = JSON.stringify(ids)

    const code = `
      const model = sails.models[${JSON.stringify(modelIdentity)}];
      const ids = JSON.parse(${JSON.stringify(idsJson)});
      const deleted = await model.destroy({ ${modelMeta.primaryKey}: { in: ids } }).fetch();
      return { deletedCount: deleted.length };
    `

    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(code)
    const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

    if (!result.success) {
      throw { badRequest: result.error || 'Failed to bulk delete records.' }
    }

    try {
      return JSON.parse(result.output)
    } catch {
      throw { badRequest: 'Failed to parse bulk delete response.' }
    }
  }
}
