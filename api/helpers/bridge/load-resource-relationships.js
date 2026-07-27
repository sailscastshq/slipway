module.exports = {
  friendlyName: 'Load Bridge resource relationships',

  description:
    'Load bounded, display-safe relationship data for a Bridge record.',

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
    recordId: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, resources, resource, recordId }) {
    const definitions = []

    for (const relationship of Object.values(resource.relationships || {})) {
      if (relationship.show !== true) continue
      const relatedResource = resources?.[relationship.resource]
      if (
        !relatedResource ||
        relatedResource.hidden ||
        relatedResource.actions?.viewAny !== true
      ) {
        continue
      }

      definitions.push({
        alias: relationship.alias,
        type: relationship.type,
        label: relationship.label,
        identity: relatedResource.identity,
        primaryKey: relatedResource.primaryKey,
        title: relatedResource.title,
        fields: relationship.fields,
        limit: relationship.limit,
        canAttach:
          relationship.type === 'collection' &&
          relationship.attach === true &&
          resource.actions?.update === true,
        canDetach:
          relationship.type === 'collection' &&
          relationship.detach === true &&
          resource.actions?.update === true
      })
    }

    if (definitions.length === 0) return {}

    const criteria = { [resource.primaryKey]: recordId }
    const queryCode = `
      const parentIdentity = ${JSON.stringify(resource.identity)};
      const parentPrimaryKey = ${JSON.stringify(resource.primaryKey)};
      const criteria = ${JSON.stringify(criteria)};
      const definitions = ${JSON.stringify(definitions)};
      const parentModel = sails.models[parentIdentity];
      if (!parentModel) {
        throw new Error('Configured Bridge parent model is unavailable.');
      }

      const modelAliases = definitions
        .filter((definition) => definition.type === 'model')
        .map((definition) => definition.alias);
      const parent = await parentModel
        .findOne(criteria)
        .select(Array.from(new Set([parentPrimaryKey, ...modelAliases])));
      if (!parent) return {};

      function present(definition, record) {
        if (!record) return null;
        const values = {};
        for (const field of definition.fields) {
          values[field] = record[field];
        }
        return {
          id: record[definition.primaryKey],
          label: record[definition.title] == null
            ? '#' + record[definition.primaryKey]
            : String(record[definition.title]),
          values
        };
      }

      const relationships = {};
      for (const definition of definitions) {
        const relatedModel = sails.models[definition.identity];
        if (!relatedModel) continue;

        if (definition.type === 'model') {
          const relatedId = parent[definition.alias];
          const relatedRecord =
            relatedId === undefined || relatedId === null
              ? null
              : await relatedModel
                  .findOne({ [definition.primaryKey]: relatedId })
                  .select(definition.fields);
          relationships[definition.alias] = {
            ...definition,
            record: present(definition, relatedRecord)
          };
          continue;
        }

        const owner = await parentModel.findOne(criteria).populate(
          definition.alias,
          {
            sort: definition.title + ' ASC',
            limit: definition.limit + 1,
            select: definition.fields
          }
        );
        const relatedRecords = owner?.[definition.alias] || [];
        relationships[definition.alias] = {
          ...definition,
          records: relatedRecords
            .slice(0, definition.limit)
            .map((record) => present(definition, record)),
          hasMore: relatedRecords.length > definition.limit
        };
      }

      return relationships;
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(queryCode)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      const error = new Error(
        result.error || 'Failed to load Bridge relationships.'
      )
      error.code = 'BRIDGE_RELATIONSHIPS_FAILED'
      throw error
    }

    try {
      return JSON.parse(result.output)
    } catch (cause) {
      const error = new Error('Failed to parse Bridge relationships.')
      error.code = 'BRIDGE_RELATIONSHIPS_FAILED'
      error.cause = cause
      throw error
    }
  }
}
