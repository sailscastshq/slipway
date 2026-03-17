// Module-level cache: Map<environmentId, { data, expiresAt }>
const cache = new Map()
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

function clearCache(environmentId) {
  if (environmentId) {
    cache.delete(environmentId)
  } else {
    cache.clear()
  }
}

module.exports = {
  friendlyName: 'Introspect models',

  description:
    'Introspect Waterline models from a running app container, including associations and validations.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    environmentId: {
      type: 'number',
      required: true,
      description: 'Environment ID for caching'
    },
    skipCache: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, environmentId, skipCache }) {
    // Check cache
    if (!skipCache) {
      const cached = cache.get(environmentId)
      if (cached && Date.now() < cached.expiresAt) {
        return cached.data
      }
    }

    const code = buildIntrospectionCode()
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(code)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      return { models: {}, error: result.error }
    }

    try {
      const models = JSON.parse(result.output)
      const data = { models }

      // Store in cache
      cache.set(environmentId, {
        data,
        expiresAt: Date.now() + CACHE_TTL
      })

      return data
    } catch (err) {
      return { models: {}, error: 'Failed to parse models: ' + err.message }
    }
  },

  clearCache
}

function buildIntrospectionCode() {
  return `
    const models = {};
    for (const [identity, model] of Object.entries(sails.models)) {
      if (identity.startsWith('_') || !model.attributes) continue;

      models[identity] = {
        identity: model.identity,
        globalId: model.globalId,
        tableName: model.tableName || model.identity,
        primaryKey: model.primaryKey || 'id',
        attributes: {},
        associations: []
      };

      for (const [attrName, attr] of Object.entries(model.attributes)) {
        // Handle associations
        if (attr.model) {
          models[identity].associations.push({
            alias: attrName,
            type: 'model',
            model: attr.model
          });
          models[identity].attributes[attrName] = {
            type: 'number',
            model: attr.model,
            columnName: attr.columnName || attrName,
            required: attr.required || false
          };
          continue;
        }
        if (attr.collection) {
          models[identity].associations.push({
            alias: attrName,
            type: 'collection',
            collection: attr.collection,
            via: attr.via || null
          });
          continue;
        }

        models[identity].attributes[attrName] = {
          type: attr.type,
          columnType: attr.columnType,
          columnName: attr.columnName || attrName,
          required: attr.required || false,
          unique: attr.unique || false,
          defaultsTo: attr.defaultsTo,
          autoCreatedAt: attr.autoCreatedAt || false,
          autoUpdatedAt: attr.autoUpdatedAt || false,
          autoIncrement: attr.autoMigrations?.autoIncrement || false,
          allowNull: attr.allowNull || false,
          isEmail: attr.isEmail || false,
          isIn: attr.isIn || null,
          maxLength: attr.maxLength || null,
          encrypt: !!attr.encrypt,
          validations: {}
        };

        // Collect validation rules
        if (attr.isEmail) models[identity].attributes[attrName].validations.isEmail = true;
        if (attr.isIn) models[identity].attributes[attrName].validations.isIn = attr.isIn;
        if (attr.maxLength) models[identity].attributes[attrName].validations.maxLength = attr.maxLength;
        if (attr.minLength) models[identity].attributes[attrName].validations.minLength = attr.minLength;
        if (attr.regex) models[identity].attributes[attrName].validations.regex = String(attr.regex);
      }
    }

    return models;
  `
}
