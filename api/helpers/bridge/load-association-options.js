module.exports = {
  friendlyName: 'Load Bridge association options',

  description:
    'Load minimal labels and primary keys for configured belongs-to fields.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    resources: {
      type: 'ref',
      required: true
    },
    resource: {
      type: 'ref',
      required: true
    },
    surface: {
      type: 'string',
      required: true,
      isIn: ['create', 'edit']
    },
    values: {
      type: 'ref',
      defaultsTo: {}
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, resources, resource, surface, values }) {
    const surfaceFields = new Set(resource[surface] || [])
    const definitions = []

    for (const association of resource.associations || []) {
      if (
        association.type !== 'model' ||
        !surfaceFields.has(association.alias)
      ) {
        continue
      }

      const relatedResource = Object.prototype.hasOwnProperty.call(
        resources,
        association.model
      )
        ? resources[association.model]
        : null
      if (!relatedResource || relatedResource.hidden) continue
      const relationship = resource.relationships?.[association.alias]
      if (!relationship) continue

      definitions.push({
        alias: association.alias,
        identity: relatedResource.identity,
        primaryKey: relatedResource.primaryKey,
        title: relatedResource.title,
        limit: relationship.limit,
        selectedId: values?.[association.alias]
      })
    }

    if (definitions.length === 0) return {}

    const queryCode = `
      const definitions = ${JSON.stringify(definitions)};
      const options = {};

      for (const definition of definitions) {
        const model = sails.models[definition.identity];
        if (!model) {
          options[definition.alias] = [];
          continue;
        }

        const fields = Array.from(new Set([
          definition.primaryKey,
          definition.title
        ].filter(Boolean)));
        const records = await model
          .find({
            sort: definition.title + ' ASC',
            limit: definition.limit
          })
          .select(fields);
        if (
          definition.selectedId !== undefined &&
          definition.selectedId !== null &&
          !records.some(
            (record) =>
              String(record[definition.primaryKey]) ===
              String(definition.selectedId)
          )
        ) {
          const selected = await model
            .findOne({
              [definition.primaryKey]: definition.selectedId
            })
            .select(fields);
          if (selected) records.unshift(selected);
        }
        options[definition.alias] = records.map((record) => ({
          id: record[definition.primaryKey],
          label: record[definition.title] == null
            ? '#' + record[definition.primaryKey]
            : String(record[definition.title])
        }));
      }

      return options;
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(queryCode)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      const error = new Error(
        result.error || 'Failed to load association options.'
      )
      error.code = 'BRIDGE_ASSOCIATION_OPTIONS_FAILED'
      throw error
    }

    try {
      return JSON.parse(result.output)
    } catch (cause) {
      const error = new Error('Failed to parse Bridge association options.')
      error.code = 'BRIDGE_ASSOCIATION_OPTIONS_FAILED'
      error.cause = cause
      throw error
    }
  }
}
