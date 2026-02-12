module.exports = {
  friendlyName: 'Destroy record',

  description: 'Delete a single record from a Waterline model.',

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
    recordId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function ({ projectSlug, environmentSlug, model: modelIdentity, recordId }) {
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

    const code = `
      const model = sails.models[${JSON.stringify(modelIdentity)}];
      const record = await model.destroyOne({ ${modelMeta.primaryKey}: ${JSON.stringify(recordId)} });
      return { deleted: !!record };
    `

    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(code)
    const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

    if (!result.success) {
      throw { badRequest: result.error || 'Failed to delete record.' }
    }

    try {
      return JSON.parse(result.output)
    } catch {
      throw { badRequest: 'Failed to parse delete response.' }
    }
  }
}
