module.exports = {
  friendlyName: 'Search Bridge relationship options',

  description:
    'Load one bounded page of safe relationship choices from a target application.',

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
    relationshipAlias: {
      type: 'string',
      required: true
    },
    search: {
      type: 'string',
      defaultsTo: ''
    },
    page: {
      type: 'number',
      defaultsTo: 1
    },
    recordId: {
      type: 'ref'
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

  fn: async function ({
    containerName,
    resources,
    resource,
    relationshipAlias,
    search,
    page,
    recordId,
    values
  }) {
    const relationship = resource.relationships?.[relationshipAlias]
    if (!relationship) {
      throw relationshipError(
        `Bridge relationship "${resource.identity}.${relationshipAlias}" is unavailable.`
      )
    }

    const relatedResource = resources?.[relationship.resource]
    if (!relatedResource || relatedResource.hidden) {
      throw relationshipError(
        `Bridge relationship "${resource.identity}.${relationshipAlias}" has no visible resource.`
      )
    }

    const normalizedPage = Number.isSafeInteger(page) && page > 0 ? page : 1
    const normalizedSearch = String(search || '')
      .trim()
      .slice(0, 100)
    const limit = Math.min(Math.max(relationship.limit || 20, 1), 50)
    const declaredDependencies = new Set(
      Object.values(relationship.where || {})
        .map((constraint) => constraint?.fromField)
        .filter(Boolean)
    )
    const unknownDependency = Object.keys(values || {}).find(
      (field) => !declaredDependencies.has(field)
    )
    if (unknownDependency) {
      const error = relationshipError(
        `Bridge relationship dependency "${unknownDependency}" is not declared.`
      )
      error.code = 'BRIDGE_RELATIONSHIP_SCOPE_INVALID'
      throw error
    }
    const scope = await sails.helpers.bridge.resolveRelationshipScope.with({
      resource,
      relationship,
      values
    })
    if (!scope.ready) {
      const sourceField = scope.missing[0]
      const error = relationshipError(
        `Choose ${
          resource.attributes?.[sourceField]?.label || sourceField
        } before loading ${relationship.label}.`
      )
      error.code = 'BRIDGE_RELATIONSHIP_SCOPE_REQUIRED'
      throw error
    }
    const definition = {
      alias: relationship.alias,
      type: relationship.type,
      identity: relatedResource.identity,
      primaryKey: relatedResource.primaryKey,
      title: relatedResource.title,
      search: relationship.search,
      limit,
      page: normalizedPage,
      query: normalizedSearch,
      where: scope.where,
      parentIdentity: resource.identity,
      parentPrimaryKey: resource.primaryKey,
      recordId
    }

    const queryCode = `
      const definition = ${JSON.stringify(definition)};
      const model = sails.models[definition.identity];
      if (!model) {
        throw new Error('Configured Bridge relationship model is unavailable.');
      }

      const textSearch = definition.query && definition.search.length > 0
        ? {
            or: definition.search.map((field) => ({
              [field]: { contains: definition.query }
            }))
          }
        : null;
      const where = textSearch && Object.keys(definition.where).length > 0
        ? { and: [definition.where, textSearch] }
        : textSearch || definition.where;
      const fields = Array.from(new Set([
        definition.primaryKey,
        definition.title
      ].filter(Boolean)));
      const records = await model
        .find({
          where,
          sort: definition.title + ' ASC',
          skip: (definition.page - 1) * definition.limit,
          limit: definition.limit + 1
        })
        .select(fields);
      const pageRecords = records.slice(0, definition.limit);
      const attachedIds = new Set();

      if (
        definition.type === 'collection' &&
        definition.recordId !== undefined &&
        definition.recordId !== null &&
        pageRecords.length > 0
      ) {
        const parentModel = sails.models[definition.parentIdentity];
        if (!parentModel) {
          throw new Error('Configured Bridge parent model is unavailable.');
        }
        const candidateIds = pageRecords.map(
          (record) => record[definition.primaryKey]
        );
        const owner = await parentModel
          .findOne({
            [definition.parentPrimaryKey]: definition.recordId
          })
          .populate(definition.alias, {
            where: {
              [definition.primaryKey]: { in: candidateIds }
            },
            select: [definition.primaryKey],
            limit: candidateIds.length
          });
        for (const related of owner?.[definition.alias] || []) {
          attachedIds.add(String(related[definition.primaryKey]));
        }
      }

      return {
        options: pageRecords.map((record) => ({
          id: record[definition.primaryKey],
          label: record[definition.title] == null
            ? '#' + record[definition.primaryKey]
            : String(record[definition.title]),
          attached: attachedIds.has(String(record[definition.primaryKey]))
        })),
        page: definition.page,
        limit: definition.limit,
        hasMore: records.length > definition.limit
      };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(queryCode)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      const error = relationshipError(
        result.error || 'Failed to search Bridge relationship options.'
      )
      error.code = 'BRIDGE_RELATIONSHIP_SEARCH_FAILED'
      throw error
    }

    try {
      return JSON.parse(result.output)
    } catch (cause) {
      const error = relationshipError(
        'Failed to parse Bridge relationship options.'
      )
      error.code = 'BRIDGE_RELATIONSHIP_SEARCH_FAILED'
      error.cause = cause
      throw error
    }
  }
}

function relationshipError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_RELATIONSHIP_NOT_ALLOWED'
  return error
}
