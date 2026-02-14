module.exports = {
  friendlyName: 'Stop app',

  description: 'Stop the running container for an environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
    },
    appSlug: {
      type: 'string',
      description: 'Target app slug (defaults to default app)'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project || project.team.id !== user.team) {
      throw 'notFound'
    }

    const environment = await Environment.findOne({ project: project.id, slug: environmentSlug })

    if (!environment) {
      throw 'notFound'
    }

    let app
    if (appSlug) {
      app = await App.findOne({ environment: environment.id, slug: appSlug })
    } else {
      app = await App.findOne({ environment: environment.id, isDefault: true })
        || await App.findOne({ environment: environment.id })
    }

    if (!app || !app.containerName) {
      throw 'notFound'
    }

    try {
      await sails.helpers.docker.stopContainer.with({
        containerName: app.containerName,
        remove: false
      })

      await App.updateOne({ id: app.id }).set({ status: 'stopped' })

      sails.log.info(`Stopped container ${app.containerName} for ${projectSlug}/${environmentSlug}`)

      return { message: 'App stopped' }
    } catch (err) {
      sails.log.error(`Failed to stop container: ${err.message}`)
      throw 'notFound'
    }
  }
}
