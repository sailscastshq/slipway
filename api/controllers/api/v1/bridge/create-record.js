module.exports = {
  friendlyName: 'Create record',

  description: 'Create a new record in a Waterline model.',

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
    values: {
      type: 'ref',
      required: true,
      description: 'Object of attribute values'
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function ({ projectSlug, environmentSlug, model: modelIdentity, values }) {
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

    // Sanitize: only allow known attributes, strip read-only fields
    const sanitized = {}
    for (const [key, val] of Object.entries(values)) {
      const attr = modelMeta.attributes[key]
      if (!attr) continue
      if (attr.autoCreatedAt || attr.autoUpdatedAt || attr.autoIncrement) continue
      sanitized[key] = val
    }

    // Pass values as a JSON string parsed inside the container to prevent injection
    const valuesJson = JSON.stringify(sanitized)

    const code = `
      const model = sails.models[${JSON.stringify(modelIdentity)}];
      const values = JSON.parse(${JSON.stringify(valuesJson)});
      const record = await model.create(values).fetch();
      return record;
    `

    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(code)
    const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

    if (!result.success) {
      throw { badRequest: result.error || 'Failed to create record.' }
    }

    try {
      return { record: JSON.parse(result.output) }
    } catch {
      throw { badRequest: 'Failed to parse create response.' }
    }
  }
}
