module.exports = {
  friendlyName: 'Resolve target app',

  description:
    'Resolve an app-scoped deployment target, falling back to the default app.',

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
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    appNotFound: {
      description: 'No matching app exists in the environment.'
    }
  },

  fn: async function ({ environment, app, appSlug }) {
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
    } else {
      targetApp = apps.find((candidate) => candidate.isDefault) || apps[0]
    }

    if (!targetApp) throw 'appNotFound'

    return { app: targetApp }
  }
}
