module.exports = {
  friendlyName: 'Destroy project',

  description: 'Delete a project and all associated resources.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    notFound: {
      responseType: 'inertiaRedirect'
    }
  },

  fn: async function ({ slug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })
      .populate('environments')

    if (!project) {
      throw { notFound: '/' }
    }

    // Delete all associated resources for each environment
    for (const env of project.environments) {
      // Stop and remove app container
      const app = await App.findOne({ environment: env.id })
      if (app && app.containerName) {
        try {
          await sails.helpers.docker.stopContainer(app.containerName)
        } catch (err) {
          sails.log.warn(`Failed to stop container ${app.containerName}: ${err.message}`)
        }
      }

      // Stop and remove service containers
      const services = await Service.find({ environment: env.id })
      for (const service of services) {
        try {
          await sails.helpers.docker.destroyService(service.id)
        } catch (err) {
          sails.log.warn(`Failed to destroy service ${service.name}: ${err.message}`)
        }
      }

      // Remove Caddy route
      try {
        await sails.helpers.caddy.removeRoute(`slipway-${project.slug}-${env.slug}`)
      } catch (err) {
        sails.log.warn(`Failed to remove Caddy route: ${err.message}`)
      }

      // Delete database records
      await Deployment.destroy({ environment: env.id })
      await App.destroy({ environment: env.id })
      await Service.destroy({ environment: env.id })
      await Environment.destroyOne({ id: env.id })
    }

    // Audit log
    await sails.helpers.audit.log({
      action: 'project.destroyed',
      resourceType: 'project',
      resourceId: project.id,
      details: { name: project.name, slug },
      userId: user.id,
      teamId: user.team.id,
      ipAddress: this.req.ip
    })

    await Project.destroyOne({ id: project.id })

    sails.inertia.flash('success', `Project "${project.name}" deleted.`)
    return '/'
  }
}
