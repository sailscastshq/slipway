// Module-level cache: Map<environmentId:containerName, { data, expiresAt }>
const cache = new Map()
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

function clearCache(environmentId) {
  if (environmentId) {
    const prefix = `${environmentId}:`
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key)
    }
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
    const cacheKey = `${environmentId}:${containerName}`

    // Check cache
    if (!skipCache) {
      const cached = cache.get(cacheKey)
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
      const introspection = JSON.parse(result.output)
      const contract =
        await sails.helpers.bridge.normalizeResourceContract.with({
          models: introspection.models,
          config: introspection.config
        })
      const data = {
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources || {},
        dashboards: contract.dashboards || {}
      }

      // Store in cache
      cache.set(cacheKey, {
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
          const relatedModel = sails.models[attr.model];
          const relatedPrimaryKey = relatedModel?.primaryKey || 'id';
          const relatedPrimaryKeyAttribute =
            relatedModel?.attributes?.[relatedPrimaryKey] || {};
          const relatedPrimaryKeyType =
            relatedPrimaryKeyAttribute.type || attr.type || 'number';

          models[identity].associations.push({
            alias: attrName,
            type: 'model',
            model: attr.model,
            primaryKey: relatedPrimaryKey,
            primaryKeyType: relatedPrimaryKeyType
          });
          models[identity].attributes[attrName] = {
            type: relatedPrimaryKeyType,
            model: attr.model,
            columnName: attr.columnName || attrName,
            required: attr.required || false,
            allowNull: attr.allowNull || false,
            isUUID: relatedPrimaryKeyAttribute.isUUID || false,
            maxLength: relatedPrimaryKeyAttribute.maxLength || null,
            description: attr.description || null,
            validations: {
              isUUID: relatedPrimaryKeyAttribute.isUUID || false
            }
          };
          continue;
        }
        if (attr.collection) {
          models[identity].associations.push({
            alias: attrName,
            type: 'collection',
            collection: attr.collection,
            via: attr.via || null,
            dominant: attr.dominant === true,
            on: attr.on || null
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
          autoIncrement:
            attr.autoIncrement ||
            attr.autoMigrations?.autoIncrement ||
            false,
          allowNull: attr.allowNull || false,
          isEmail: attr.isEmail || false,
          isURL: attr.isURL || false,
          isUUID: attr.isUUID || false,
          isIn: attr.isIn || null,
          min: attr.min ?? null,
          max: attr.max ?? null,
          minLength: attr.minLength || null,
          maxLength: attr.maxLength || null,
          description: attr.description || null,
          encrypt: !!attr.encrypt,
          protect: !!attr.protect,
          validations: {}
        };

        // Collect validation rules
        if (attr.isEmail) models[identity].attributes[attrName].validations.isEmail = true;
        if (attr.isURL) models[identity].attributes[attrName].validations.isURL = true;
        if (attr.isUUID) models[identity].attributes[attrName].validations.isUUID = true;
        if (attr.isIn) models[identity].attributes[attrName].validations.isIn = attr.isIn;
        if (attr.min !== undefined) models[identity].attributes[attrName].validations.min = attr.min;
        if (attr.max !== undefined) models[identity].attributes[attrName].validations.max = attr.max;
        if (attr.maxLength) models[identity].attributes[attrName].validations.maxLength = attr.maxLength;
        if (attr.minLength) models[identity].attributes[attrName].validations.minLength = attr.minLength;
        if (attr.regex) models[identity].attributes[attrName].validations.regex = String(attr.regex);
      }
    }

    const bridgeConfig = sails.config.slipway?.bridge || {};
    const serializedBridgeConfig = JSON.stringify(
      bridgeConfig,
      function rejectUnsupportedBridgeConfig(_key, value) {
        if (
          value === undefined ||
          ['function', 'symbol', 'bigint'].includes(typeof value)
        ) {
          throw new Error(
            'sails.config.slipway.bridge must contain only serializable values.'
          );
        }
        return value;
      }
    );

    return {
      models,
      config: JSON.parse(serializedBridgeConfig)
    };
  `
}
