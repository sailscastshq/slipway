module.exports = {
  friendlyName: 'Resolve target app',

  description:
    'Resolve an environment deployment target and optionally require an explicit choice for multi-app environments.',

  inputs: {
    environment: {
      type: 'ref',
      required: true
    },
    app: {
      type: 'ref'
    },
    appSlug: {
      type: 'string'
    },
    requireExplicit: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    appNotFound: {
      description: 'No matching app exists in the environment.'
    },
    appSelectionRequired: {
      description: 'The environment has multiple apps and needs a choice.'
    }
  },

  fn: async function ({ environment, app, appSlug, requireExplicit }) {
    const apps = await App.find({ environment: environment.id }).sort([
      'isDefault DESC',
      'name ASC',
      'id ASC'
    ])

    let targetApp = app
    if (targetApp) {
      targetApp = apps.find(
        (candidate) => Number(candidate.id) === Number(targetApp.id)
      )
    } else if (appSlug) {
      targetApp = apps.find((candidate) => candidate.slug === appSlug)
    } else if (requireExplicit && apps.length > 1) {
      throw 'appSelectionRequired'
    } else {
      targetApp = apps.find((candidate) => candidate.isDefault) || apps[0]
    }

    if (!targetApp) throw 'appNotFound'

    return { app: targetApp, apps }
  }
}
