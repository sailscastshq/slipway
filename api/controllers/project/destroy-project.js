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
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
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
      // Stop and remove containers
      const app = await App.findOne({ environment: env.id })
      if (app && app.containerName) {
        try {
          await sails.helpers.docker.stopContainer(app.containerName)
        } catch (err) {
          sails.log.warn(`Failed to stop container ${app.containerName}: ${err.message}`)
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

    await Project.destroyOne({ id: project.id })

    return '/'
  }
}
