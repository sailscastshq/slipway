module.exports = {
  friendlyName: 'Destroy preview environment',

  description: 'Stop containers, remove routes, and delete a preview environment.',

  inputs: {
    project: {
      type: 'ref',
      required: true,
      description: 'Project record'
    },
    prNumber: {
      type: 'number',
      required: true,
      description: 'Pull request number'
    }
  },

  exits: {
    success: {
      description: 'Preview environment destroyed'
    }
  },

  fn: async function ({ project, prNumber }) {
    const slug = `pr-${prNumber}`

    const environment = await Environment.findOne({
      project: project.id,
      slug
    })

    if (!environment) {
      sails.log.verbose(`No preview environment ${slug} found for ${project.slug}`)
      return
    }

    // Stop app container
    const app = await App.findOne({ environment: environment.id, isDefault: true }) || await App.findOne({ environment: environment.id })
    if (app && app.containerName) {
      try {
        await sails.helpers.docker.stopContainer(app.containerName)
      } catch (err) {
        sails.log.warn(`Failed to stop preview app container: ${err.message}`)
      }
    }

    // Stop and remove service containers
    const services = await Service.find({ environment: environment.id })
    for (const service of services) {
      try {
        await sails.helpers.docker.destroyService(service.id)
      } catch (err) {
        sails.log.warn(`Failed to destroy preview service ${service.name}: ${err.message}`)
      }
    }

    // Remove Caddy route
    try {
      await sails.helpers.caddy.removeRoute(`slipway-${project.slug}-${slug}`)
    } catch (err) {
      sails.log.verbose(`Failed to remove Caddy route for preview: ${err.message}`)
    }

    // Delete database records
    await Deployment.destroy({ environment: environment.id })
    await App.destroy({ environment: environment.id })
    await Service.destroy({ environment: environment.id })
    await Environment.destroyOne({ id: environment.id })

    sails.log.info(`Preview environment destroyed: ${project.slug}/${slug}`)
  }
}
