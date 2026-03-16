module.exports = {
  friendlyName: 'View app',

  description: 'Display app detail page with logs, deployments, services, and platform tools.',

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
    },
    appSlug: {
      type: 'string',
      required: true,
      description: 'App slug'
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

  fn: async function ({ slug, envSlug, appSlug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw { notFound: '/' }

    const environment = await Environment.findOne({ slug: envSlug, project: project.id })
      .populate('services')
      .decrypt()
    if (!environment) throw { notFound: `/projects/${slug}` }

    const app = await App.findOne({ environment: environment.id, slug: appSlug })
    if (!app) throw { notFound: `/projects/${slug}/environments/${envSlug}` }

    // Decrypt app to get envVars
    const decryptedApp = await App.findOne({ id: app.id }).decrypt()

    // Check container health for this app
    let containerHealth = null
    if (app.containerName) {
      try {
        const containerStatus = await sails.helpers.docker.getContainerStatus(app.containerName)
        containerHealth = containerStatus.health
      } catch (err) {
        if (err.code === 'notFound' || err === 'notFound') {
          await App.updateOne({ id: app.id }).set({ status: 'stopped' })
          app.status = 'stopped'
        }
      }
    }

    const { fullDomain, generatedDomain, domains } = await Environment.resolveDomains(environment.id)
    const serverIp = await sails.helpers.getServerIp()
    const directUrl = app.hostPort && app.routePath !== null ? `http://${serverIp}:${app.hostPort}` : null

    // Fetch deployments filtered to this app (include legacy deployments without app for default app)
    let deployments
    if (app.isDefault) {
      deployments = await Deployment.find({
        or: [
          { environment: environment.id, app: app.id },
          { environment: environment.id, app: null }
        ]
      })
        .limit(20)
        .populate('triggeredBy')
    } else {
      deployments = await Deployment.find({ environment: environment.id, app: app.id })
        .limit(20)
        .populate('triggeredBy')
    }
    deployments.sort((a, b) => b.id - a.id)

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
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
      backupConfigured = !!(
        (globalEnvVars.R2_ACCESS_KEY || globalEnvVars.S3_ACCESS_KEY || globalEnvVars.SPACES_ACCESS_KEY) &&
        (globalEnvVars.R2_SECRET_KEY || globalEnvVars.S3_SECRET_KEY || globalEnvVars.SPACES_SECRET_KEY) &&
        (globalEnvVars.R2_BUCKET || globalEnvVars.S3_BUCKET || globalEnvVars.SPACES_BUCKET)
      )
    } catch { /* ignore */ }

    // Build inherited vars (global + environment)
    const inheritedVars = { ...globalEnvVars, ...(environment.envVars || {}) }

    // Generate deployment checklist
    const checklist = await sails.helpers.environment.generateChecklist(environment.id)

    return {
      page: 'projects/app',
      props: {
        project,
        environment: {
          ...environment,
          fullDomain,
          generatedDomain,
          domains,
          serverIp,
          services
        },
        app: { ...app, containerHealth, directUrl },
        appEnvVars: decryptedApp.envVars || {},
        inheritedVars,
        deployments,
        services,
        backupConfigured,
        checklist
      }
    }
  }
}
