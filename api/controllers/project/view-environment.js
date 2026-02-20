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
      .decrypt()

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Get all app records (multi-app support)
    let allApps = await App.find({ environment: environment.id })
    let app = allApps.find(a => a.isDefault) || allApps[0] || null

    // Get full domain
    const fullDomain = await Environment.getFullDomain(environment.id)

    // Build list of all available domains (for the domain dropdown)
    const subdomain = `${project.slug}-${environment.slug}`
    const wildcardDomain = await sails.helpers.setting.get('wildcardDomain')
    const serverIp = await sails.helpers.getServerIp()
    let generatedDomain
    if (wildcardDomain) {
      generatedDomain = `${subdomain}.${wildcardDomain}`
    } else if (sails.config.custom.slipwayDomain) {
      generatedDomain = `${subdomain}.${sails.config.custom.slipwayDomain}`
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

    // Check container status for all apps
    const appsWithHealth = []
    for (const a of allApps) {
      let containerExists = false
      let containerHealth = null
      if (a.containerName) {
        try {
          const containerStatus = await sails.helpers.docker.getContainerStatus(a.containerName)
          containerExists = true
          containerHealth = containerStatus.health
        } catch (err) {
          if (err.code === 'notFound' || err === 'notFound') {
            await App.updateOne({ id: a.id }).set({ status: 'stopped' })
            a.status = 'stopped'
          }
        }
      }
      appsWithHealth.push({ ...a, containerHealth, containerExists })
    }

    // Update default app reference after potential status changes
    app = appsWithHealth.find(a => a.isDefault) || appsWithHealth[0] || null

    // Fix stale running deployments
    const runningAppDeploymentIds = appsWithHealth
      .filter(a => a.containerExists && a.currentDeployment)
      .map(a => a.currentDeployment)

    if (runningAppDeploymentIds.length === 0) {
      await Deployment.update({
        environment: environment.id,
        status: 'running'
      }).set({ status: 'stopped' })
    } else {
      await Deployment.update({
        environment: environment.id,
        status: 'running',
        id: { '!=': runningAppDeploymentIds }
      }).set({ status: 'stopped' })
    }

    // Get deployments sorted by most recent first
    const deployments = await Deployment.find({ environment: environment.id })
      .limit(20)
      .populate('triggeredBy')
      .populate('app')

    // Sort by id descending (newest first) - explicit JS sort for reliability
    deployments.sort((a, b) => b.id - a.id)

    // Backfill app name for legacy deployments (created before multi-app)
    for (const dep of deployments) {
      if (!dep.app && app) {
        dep.app = { id: app.id, name: app.name, slug: app.slug }
      }
    }

    // Generate deployment checklist
    const checklist = await sails.helpers.environment.generateChecklist(environment.id)

    // Check if GitHub is connected for this team
    const gitProvider = await GitProvider.findOne({
      team: user.team.id,
      type: 'github',
      isActive: true
    })
    const githubConnected = !!gitProvider

    return {
      page: 'projects/environment',
      props: {
        project,
        environment: {
          ...environment,
          fullDomain,
          generatedDomain,
          serverIp,
          services
        },
        app: app || null,
        apps: appsWithHealth,
        envVars: environment.envVars || {},
        deployments,
        checklist,
        backupConfigured,
        githubConnected
      }
    }
  }
}
