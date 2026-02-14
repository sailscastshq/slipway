module.exports = {
  friendlyName: 'Delete environment',

  description: 'Delete an environment and all its resources.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    slug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
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
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectSlug, slug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Only owner/admin can delete environments
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({ project: project.id, slug })

    if (!environment) {
      throw 'notFound'
    }

    // Prevent deleting production environment if it's the only one
    if (environment.isProduction) {
      const envCount = await Environment.count({ project: project.id })
      if (envCount === 1) {
        throw {
          badRequest: {
            problems: [{ environment: 'Cannot delete the only production environment.' }]
          }
        }
      }
    }

    // Stop and remove ALL app containers
    const apps = await App.find({ environment: environment.id })
    for (const app of apps) {
      if (app.containerName) {
        try {
          await sails.helpers.docker.stopContainer(app.containerName)
        } catch (err) {
          sails.log.warn(`Failed to stop app container ${app.containerName}: ${err.message}`)
        }
      }
    }

    const services = await Service.find({ environment: environment.id })
    for (const service of services) {
      try {
        await sails.helpers.docker.destroyService(service.id)
      } catch (err) {
        sails.log.warn(`Failed to destroy service ${service.name}: ${err.message}`)
      }
    }

    // Remove Caddy route
    try {
      await sails.helpers.caddy.removeRoute(`slipway-${project.slug}-${slug}`)
    } catch (err) {
      sails.log.warn(`Failed to remove Caddy route: ${err.message}`)
    }

    // Delete database records
    await Deployment.destroy({ environment: environment.id })
    await App.destroy({ environment: environment.id })
    await Service.destroy({ environment: environment.id })
    await Environment.destroyOne({ id: environment.id })

    return { message: 'Environment deleted successfully' }
  }
}
