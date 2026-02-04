module.exports = {
  friendlyName: 'View environment',

  description: 'Display environment detail page with env vars, services, and deployments.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    envSlug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, envSlug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({ slug: envSlug, project: project.id })
      .populate('services')
      .populate('deployments')

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Get the app record (container state)
    const app = await App.findOne({ environment: environment.id })

    // Get full domain
    const fullDomain = await Environment.getFullDomain(environment.id)

    // Build list of all available domains (for the domain dropdown)
    const subdomain = `${project.slug}-${environment.slug}`
    const wildcardDomain = await sails.helpers.setting.get('wildcardDomain')
    let generatedDomain
    if (wildcardDomain) {
      generatedDomain = `${subdomain}.${wildcardDomain}`
    } else {
      const serverIp = await sails.helpers.getServerIp()
      generatedDomain = `${subdomain}.${serverIp}.sslip.io`
    }

    // Enrich services with connection URLs
    const services = await Promise.all(
      (environment.services || []).map(async (service) => {
        const connectionUrl = await Service.getConnectionUrl(service.id)
        return {
          ...service,
          connectionUrl
        }
      })
    )

    // Sort deployments by most recent
    const deployments = await Deployment.find({ environment: environment.id })
      .sort('createdAt DESC')
      .limit(20)
      .populate('triggeredBy')

    return {
      page: 'projects/environment',
      props: {
        project,
        environment: {
          ...environment,
          fullDomain,
          generatedDomain,
          services
        },
        app: app || null,
        envVars: environment.envVars || {},
        deployments
      }
    }
  }
}
