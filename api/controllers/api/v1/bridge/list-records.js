module.exports = {
  friendlyName: 'List records',

  description: 'Server-side paginated records for a Waterline model.',

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
      required: true,
      description: 'Model identity (e.g. "user")'
    },
    page: {
      type: 'number',
      defaultsTo: 1,
      min: 1
    },
    perPage: {
      type: 'number',
      defaultsTo: 20,
      min: 1,
      max: 100
    },
    sort: {
      type: 'string',
      defaultsTo: 'createdAt DESC',
      description: 'Sort clause (e.g. "createdAt DESC")'
    },
    search: {
      type: 'string',
      defaultsTo: '',
      description: 'Search term (searches across string attributes)'
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function ({ projectSlug, environmentSlug, model: modelIdentity, page, perPage, sort, search }) {
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

    // Get models to validate the model identity and sort attribute
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

    // Validate sort attribute
    const [sortAttr, sortDir] = sort.split(' ')
    const validSortDir = ['ASC', 'DESC'].includes((sortDir || 'ASC').toUpperCase()) ? (sortDir || 'ASC').toUpperCase() : 'ASC'
    const knownAttrs = Object.keys(modelMeta.attributes)
    const validSortAttr = knownAttrs.includes(sortAttr) ? sortAttr : modelMeta.primaryKey

    // Build search criteria
    let searchCriteria = ''
    if (search.trim()) {
      const stringAttrs = knownAttrs.filter(a => {
        const attr = modelMeta.attributes[a]
        return attr.type === 'string' && !attr.encrypt
      })
      if (stringAttrs.length > 0) {
        const term = search.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")
        const orClauses = stringAttrs.map(a => `{ '${a}': { contains: '${term}' } }`).join(', ')
        searchCriteria = `{ or: [${orClauses}] }`
      }
    }

    const criteria = searchCriteria || '{}'
    const skip = (page - 1) * perPage

    const code = `
      const model = sails.models[${JSON.stringify(modelIdentity)}];
      const criteria = ${criteria};
      const [records, total] = await Promise.all([
        model.find(criteria).sort('${validSortAttr} ${validSortDir}').skip(${skip}).limit(${perPage}),
        model.count(criteria)
      ]);
      return { records, total, page: ${page}, perPage: ${perPage}, totalPages: Math.ceil(total / ${perPage}) };
    `

    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(code)
    const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

    if (!result.success) {
      throw { badRequest: result.error || 'Failed to list records.' }
    }

    try {
      return JSON.parse(result.output)
    } catch {
      throw { badRequest: 'Failed to parse records response.' }
    }
  }
}
