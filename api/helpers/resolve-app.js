module.exports = {
  friendlyName: 'Resolve app',

  description: 'Resolve user → project → environment → app from request params. Central resolver for multi-app support.',

  inputs: {
    req: {
      type: 'ref',
      required: true,
      description: 'The request object'
    },
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    appSlug: {
      type: 'string',
      description: 'Optional app slug. If omitted, resolves the default app.'
    },
    requireRunning: {
      type: 'boolean',
      defaultsTo: false,
      description: 'If true, throws appNotRunning when app is not in running state'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    notFound: {
      description: 'Project, environment, or app not found'
    },
    forbidden: {
      description: 'User does not have access'
    },
    appNotRunning: {
      description: 'App is not running'
    }
  },

  fn: async function ({ req, projectSlug, environmentSlug, appSlug, requireRunning }) {
    const user = await User.findOne({ id: req.session.userId })
    if (!user) {
      throw 'forbidden'
    }

    const project = await Project.findOne({ slug: projectSlug }).populate('team')
    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    // Resolve app: explicit slug → default → any
    let app
    if (appSlug) {
      app = await App.findOne({ environment: environment.id, slug: appSlug })
    } else {
      app = await App.findOne({ environment: environment.id, isDefault: true })
        || await App.findOne({ environment: environment.id })
    }

    if (!app) {
      throw 'notFound'
    }

    if (requireRunning && (app.status !== 'running' || !app.containerName)) {
      throw 'appNotRunning'
    }

    // Fetch all apps in environment
    const apps = await App.find({ environment: environment.id })

    return { user, project, environment, app, apps }
  }
}
