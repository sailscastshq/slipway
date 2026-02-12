module.exports = {
  friendlyName: 'List models',

  description: 'Return all Waterline models with attributes, associations, and record counts.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
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

    // Get model introspection (cached)
    const introspection = await sails.helpers.bridge.introspectModels(
      app.containerName,
      environment.id
    )

    if (introspection.error) {
      throw { badRequest: introspection.error }
    }

    const models = introspection.models
    const identities = Object.keys(models)

    // Build count queries for all models in one container exec
    if (identities.length > 0) {
      const countCode = `
        const counts = {};
        ${identities.map(id => `
          try {
            counts['${id}'] = await sails.models['${id}'].count();
          } catch(e) { counts['${id}'] = 0; }
        `).join('\n')}
        return counts;
      `
      const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(countCode)
      const countResult = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

      if (countResult.success) {
        try {
          const counts = JSON.parse(countResult.output)
          for (const id of identities) {
            models[id].count = counts[id] || 0
          }
        } catch { /* counts remain undefined */ }
      }
    }

    return { models }
  }
}
