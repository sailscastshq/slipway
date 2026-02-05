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

    // Fix stale running deployments
    // Mark as stopped if: no app, no currentDeployment, or app status is not 'running'
    const hasRunningApp = app && app.currentDeployment && app.status === 'running'
    
    if (!hasRunningApp) {
      // No running app, mark all "running" deployments as "stopped"
      await Deployment.update({
        environment: environment.id,
        status: 'running'
      }).set({ status: 'stopped' })
    } else {
      // Only the current deployment should be "running"
      await Deployment.update({
        environment: environment.id,
        status: 'running',
        id: { '!=': app.currentDeployment }
      }).set({ status: 'stopped' })
    }

    // Get deployments sorted by most recent first
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
