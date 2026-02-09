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
    let app = await App.findOne({ environment: environment.id })

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

    // Enrich services with connection URLs and last backup
    const services = await Promise.all(
      (environment.services || []).map(async (service) => {
        const connectionUrl = await Service.getConnectionUrl(service.id)
        let lastBackup = null
        if (Service.isBackupSupported(service.type)) {
          const backups = await Backup.find({ service: service.id })
            .sort('createdAt DESC')
            .limit(1)
          lastBackup = backups[0] || null
        }
        return {
          ...service,
          connectionUrl,
          lastBackup,
          backupSupported: Service.isBackupSupported(service.type)
        }
      })
    )

    // Check if backup storage is configured
    let backupConfigured = false
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      const globalVars = JSON.parse(globalJson)
      backupConfigured = !!(
        (globalVars.R2_ACCESS_KEY || globalVars.S3_ACCESS_KEY || globalVars.SPACES_ACCESS_KEY) &&
        (globalVars.R2_SECRET_KEY || globalVars.S3_SECRET_KEY || globalVars.SPACES_SECRET_KEY) &&
        (globalVars.R2_BUCKET || globalVars.S3_BUCKET || globalVars.SPACES_BUCKET)
      )
    } catch { /* ignore */ }

    // Check if container actually exists and get its health status
    let containerExists = false
    let containerHealth = null
    if (app && app.containerName) {
      try {
        const containerStatus = await sails.helpers.docker.getContainerStatus(app.containerName)
        containerExists = true
        containerHealth = containerStatus.health
      } catch (err) {
        if (err.code === 'notFound' || err === 'notFound') {
          // Container doesn't exist - update app status
          await App.updateOne({ id: app.id }).set({ status: 'stopped' })
          app = await App.findOne({ id: app.id })
        }
      }
    }

    // Fix stale running deployments
    const hasRunningApp = containerExists && app && app.currentDeployment
    
    if (!hasRunningApp) {
      await Deployment.update({
        environment: environment.id,
        status: 'running'
      }).set({ status: 'stopped' })
    } else {
      await Deployment.update({
        environment: environment.id,
        status: 'running',
        id: { '!=': app.currentDeployment }
      }).set({ status: 'stopped' })
    }

    // Get deployments sorted by most recent first
    const deployments = await Deployment.find({ environment: environment.id })
      .limit(20)
      .populate('triggeredBy')

    // Sort by id descending (newest first) - explicit JS sort for reliability
    deployments.sort((a, b) => b.id - a.id)

    // Generate deployment checklist
    const checklist = await sails.helpers.environment.generateChecklist(environment.id)

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
        app: app ? { ...app, containerHealth } : null,
        envVars: environment.envVars || {},
        deployments,
        checklist,
        backupConfigured
      }
    }
  }
}
