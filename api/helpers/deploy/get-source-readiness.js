const { inspectBuildContext } = require('./ensure-build-context')._private

module.exports = {
  friendlyName: 'Get source readiness',

  description:
    'Describe whether an app has pushed source or a usable repository for deployment.',

  inputs: {
    project: {
      type: 'ref',
      required: true
    },
    environment: {
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

  fn: async function ({ project, environment, app }) {
    const readiness = await inspectBuildContext({
      project,
      environment,
      app
    })

    if (readiness.available) {
      return {
        available: true,
        mode: readiness.sourceMode,
        message:
          readiness.sourceMode === 'repository'
            ? 'The connected repository is ready to sync and deploy.'
            : 'The latest CLI-pushed source is ready to deploy.'
      }
    }

    return {
      available: false,
      mode: readiness.hasConnectedRepository ? 'repository-incomplete' : 'none',
      message: readiness.hasConnectedRepository
        ? 'The repository connection is incomplete. Reconnect it or push source from your project before deploying.'
        : 'No deployable source is available. Run `slipway slide` from your project or connect a repository.'
    }
  }
}
