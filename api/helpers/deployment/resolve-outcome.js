module.exports = {
  friendlyName: 'Resolve deployment outcome',

  description:
    'Resolve the App traffic owner for a deployment and return its user-facing outcome.',

  inputs: {
    deployment: {
      type: 'ref',
      required: true
    },
    app: {
      type: 'ref'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ deployment, app }) {
    const associatedAppId =
      deployment.app && typeof deployment.app === 'object'
        ? deployment.app.id
        : deployment.app
    const environmentId =
      deployment.environment && typeof deployment.environment === 'object'
        ? deployment.environment.id
        : deployment.environment

    let resolvedApp = app || null
    if (!resolvedApp && associatedAppId) {
      resolvedApp = await App.findOne({ id: associatedAppId })
    }
    if (!resolvedApp && environmentId) {
      resolvedApp =
        (await App.findOne({ environment: environmentId, isDefault: true })) ||
        (await App.findOne({ environment: environmentId }))
    }

    const state = sails.helpers.deployment.describeOutcome.with({
      deployment,
      currentDeploymentIds: resolvedApp?.currentDeployment
        ? [resolvedApp.currentDeployment]
        : []
    })

    return {
      ...state,
      appId: resolvedApp?.id || associatedAppId || null
    }
  }
}
