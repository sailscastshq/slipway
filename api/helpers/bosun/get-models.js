module.exports = {
  friendlyName: 'Get Bosun models',

  description:
    'Collect Slipway runtime Waterline models for a selected datastore.',

  inputs: {
    database: {
      type: 'string',
      defaultsTo: 'app',
      isIn: ['app', 'observability', 'cache']
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ database }) {
    const { datastore } = await sails.helpers.bosun.getDatabaseService(database)
    const models = {}

    for (const [identity, model] of Object.entries(sails.models)) {
      if (identity.startsWith('_') || !model.attributes) {
        continue
      }

      const modelDatastore = model.datastore || 'default'
      if (modelDatastore !== datastore || identity === 'archive') {
        continue
      }

      models[identity] = {
        identity: model.identity,
        tableName: model.tableName || model.identity,
        primaryKey: model.primaryKey || 'id',
        attributes: {}
      }

      for (const [attrName, attr] of Object.entries(model.attributes)) {
        const schemaAttr = model.schema?.[attrName] || {}
        const columnName = schemaAttr.columnName || attr.columnName || attrName

        if (attr.collection) {
          continue
        }

        if (attr.model) {
          models[identity].attributes[attrName] = {
            type: 'number',
            columnName,
            required: attr.required || false,
            unique: attr.unique || false,
            foreignKey: true,
            references: attr.model
          }
          continue
        }

        models[identity].attributes[attrName] = {
          type: attr.type,
          columnType:
            attr.columnType ||
            schemaAttr.columnType ||
            attr.autoMigrations?.columnType ||
            schemaAttr.autoMigrations?.columnType,
          columnName,
          required: attr.required || false,
          unique: attr.unique || false,
          index: attr.index || false,
          defaultsTo: attr.defaultsTo,
          autoCreatedAt: attr.autoCreatedAt || false,
          autoUpdatedAt: attr.autoUpdatedAt || false,
          autoIncrement:
            attr.autoMigrations?.autoIncrement || attr.autoIncrement || false,
          allowNull: attr.allowNull
        }
      }
    }

    return {
      datastore,
      models,
      modelCount: Object.keys(models).length
    }
  }
}
