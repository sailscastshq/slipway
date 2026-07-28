module.exports = {
  friendlyName: 'Query Bridge resource',

  description:
    'Run a normalized Bridge resource query through Waterline or a configured target-app lens helper.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    resource: {
      type: 'ref',
      required: true
    },
    query: {
      type: 'ref',
      required: true
    },
    actor: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, resource, query, actor }) {
    const helper = query.lens?.helper || ''
    const queryCode = helper
      ? buildHelperQuery({ resource, query, actor, helper })
      : buildWaterlineQuery({ resource, query })
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(queryCode)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      const error = new Error(
        result.error ||
          `Failed to query ${resource.label || resource.identity}.`
      )
      error.code = 'BRIDGE_RESOURCE_QUERY_FAILED'
      throw error
    }

    let output
    try {
      output = JSON.parse(result.output)
    } catch (cause) {
      const error = new Error('Failed to parse the Bridge resource query.')
      error.code = 'BRIDGE_RESOURCE_QUERY_FAILED'
      error.cause = cause
      throw error
    }

    if (
      !output ||
      !Array.isArray(output.records) ||
      output.records.length > query.perPage ||
      !Number.isSafeInteger(Number(output.total)) ||
      Number(output.total) < 0
    ) {
      const error = new Error(
        'A Bridge lens helper must return { records, total }.'
      )
      error.code = 'BRIDGE_RESOURCE_QUERY_FAILED'
      throw error
    }

    return {
      records: output.records,
      total: Number(output.total)
    }
  }
}

function buildWaterlineQuery({ resource, query }) {
  return `
    const identity = ${JSON.stringify(resource.identity)};
    const where = ${JSON.stringify(query.where)};
    const criteria = ${JSON.stringify(query.criteria)};
    const model = sails.models[identity];
    if (!model) throw new Error('Configured Bridge model is unavailable.');

    const total = await model.count(where);
    const records = await model.find(criteria);
    return { records, total };
  `
}

function buildHelperQuery({ resource, query, actor, helper }) {
  return `
    const helperIdentity = ${JSON.stringify(helper)};
    const actor = ${JSON.stringify(actor)};
    const resource = ${JSON.stringify({
      identity: resource.identity,
      primaryKey: resource.primaryKey,
      label: resource.label,
      singularLabel: resource.singularLabel
    })};
    const query = ${JSON.stringify({
      page: query.page,
      perPage: query.perPage,
      search: query.search,
      filters: query.filters,
      where: query.where,
      criteria: query.criteria,
      columns: query.columns,
      sort: query.sort
    })};

    function resolveHelper(identity) {
      let helper = sails.helpers;
      for (const segment of identity.split('.')) {
        helper = helper && helper[segment];
      }
      if (!helper || typeof helper.with !== 'function') {
        throw new Error(
          'Configured Bridge lens helper "' + identity + '" is unavailable.'
        );
      }
      return helper;
    }

    const result = await resolveHelper(helperIdentity).with({
      actor,
      resource,
      query
    });
    if (
      !result ||
      !Array.isArray(result.records) ||
      result.records.length > query.perPage ||
      !Number.isSafeInteger(Number(result.total)) ||
      Number(result.total) < 0
    ) {
      throw new Error('A Bridge lens helper must return { records, total }.');
    }
    return {
      records: result.records,
      total: Number(result.total)
    };
  `
}
