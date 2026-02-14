module.exports = {
  friendlyName: 'Restart app',

  description: 'Restart the running container for an environment.',

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

    const { execFile } = require('child_process')
    const util = require('util')
    const execFileAsync = util.promisify(execFile)

    try {
      await execFileAsync('docker', ['restart', app.containerName])

      await App.updateOne({ id: app.id }).set({ status: 'running' })

      sails.log.info(`Restarted container ${app.containerName} for ${projectSlug}/${environmentSlug}`)

      return { message: 'App restarted' }
    } catch (err) {
      sails.log.error(`Failed to restart container: ${err.message}`)
      await App.updateOne({ id: app.id }).set({ status: 'failed' })
      throw 'notFound'
    }
  }
}
