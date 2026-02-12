module.exports = {
  friendlyName: 'Resolve environment',

  description: 'Resolve user → project → environment → app from request params. Shared auth/lookup for Bridge actions.',

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
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    notFound: {
      description: 'Project or environment not found'
    },
    forbidden: {
      description: 'User does not have access'
    },
    appNotRunning: {
      description: 'App is not running'
    }
  },

  fn: async function ({ req, projectSlug, environmentSlug }) {
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

    const app = await App.findOne({ environment: environment.id })

    if (!app || app.status !== 'running' || !app.containerName) {
      throw 'appNotRunning'
    }

    return { user, project, environment, app }
  }
}
