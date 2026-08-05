module.exports = {
  friendlyName: 'Build Bridge workspace navigation',

  description:
    'Build the small, authorized navigation contract used by app-domain Bridge pages.',

  inputs: {
    containerName: { type: 'string' },
    environmentId: { type: 'number' },
    actor: { type: 'ref', required: true },
    contract: { type: 'ref' },
    authorizedResources: { type: 'ref' }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({
    containerName,
    environmentId,
    actor,
    contract,
    authorizedResources
  }) {
    let resourceContract = contract
    let resources = authorizedResources

    if (!resourceContract && containerName && environmentId) {
      resourceContract = await sails.helpers.bridge.introspectModels(
        containerName,
        environmentId
      )
    }

    if (resourceContract?.error) {
      resourceContract = { models: {}, dashboards: {} }
    }

    if (resources === undefined && resourceContract && containerName) {
      resources = await sails.helpers.bridge.authorizeResourceActions.with({
        containerName,
        resources: resourceContract.models || {},
        actor
      })
    }

    const visibleResources = Object.values(resources || {})
      .filter(
        (resource) => !resource.hidden && resource.actions?.viewAny !== false
      )
      .map((resource) => ({
        identity: resource.identity,
        label: resource.label,
        singularLabel: resource.singularLabel
      }))
      .sort((left, right) => left.label.localeCompare(right.label))

    const dashboards = Object.values(resourceContract?.dashboards || {})
      .filter((dashboard) => dashboard.scope !== 'resource')
      .map((dashboard) => ({
        id: dashboard.id,
        label: dashboard.label,
        default: dashboard.default === true
      }))

    return {
      actor: {
        id: actor.id,
        email: actor.email,
        fullName: actor.fullName || '',
        role: actor.bridgeRole || actor.role || 'viewer'
      },
      dashboards,
      resources: visibleResources
    }
  }
}
