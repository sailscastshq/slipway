module.exports = {
  friendlyName: 'View app',

  description:
    'Display app detail page with logs, deployments, services, and platform tools.',

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
    },
    deploymentStatus: {
      type: 'string'
    },
    deploymentSource: {
      type: 'string'
    },
    deploymentCursor: {
      type: 'string'
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

  fn: async function ({
    slug,
    envSlug,
    appSlug,
    deploymentStatus,
    deploymentSource,
    deploymentCursor
  }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw { notFound: '/' }

    const environment = await Environment.findOne({
      slug: envSlug,
      project: project.id
    })
      .populate('services')
      .decrypt()
    if (!environment) throw { notFound: `/projects/${slug}` }

    const app = await App.findOne({
      environment: environment.id,
      slug: appSlug
    })
    if (!app) throw { notFound: `/projects/${slug}/environments/${envSlug}` }

    // Decrypt app to get envVars
    const decryptedApp = await App.findOne({ id: app.id }).decrypt()

    // Check container health for this app
    let containerHealth = null
    let containerStatus = null
    if (app.containerName) {
      try {
        containerStatus = await sails.helpers.docker.getContainerStatus(
          app.containerName
        )
        containerHealth = containerStatus.health
      } catch (err) {
        if (err.code === 'notFound' || err === 'notFound') {
          await App.updateOne({ id: app.id }).set({ status: 'stopped' })
          app.status = 'stopped'
        }
      }
    }

    const serverIp = await sails.helpers.getServerIp()
    let directAccess = null
    if (app.hostPort && app.routePath !== null) {
      let portBinding = null
      if (app.containerName && containerStatus?.running) {
        try {
          portBinding = await sails.helpers.docker.getPortBinding.with({
            containerName: app.containerName,
            containerPort: app.port || 1337,
            hostPort: app.hostPort,
            host: sails.config.custom.slipwayPortHost || '0.0.0.0'
          })
        } catch (error) {
          portBinding = {
            valid: false,
            diagnostic: error.message || String(error)
          }
        }
      }

      directAccess = await sails.helpers.deploy.getDirectAccess.with({
        serverIp,
        hostPort: app.hostPort,
        routePath: app.routePath,
        containerRunning: containerStatus
          ? Boolean(containerStatus.running)
          : app.status === 'running',
        portBinding
      })
    }
    const directUrl = directAccess?.url || null
    const { fullDomain, generatedDomain, domains, primaryUrl, accessUrls } =
      await Environment.resolveAppUrls(environment.id, {
        directUrl,
        directHint: directAccess?.firewallHint || null
      })

    const appWithHealth = { ...app, containerHealth }
    const deploymentHistory = await sails.helpers.deployment.getHistory.with({
      projectSlug: project.slug,
      environments: [environment],
      apps: [appWithHealth],
      currentApps: [appWithHealth],
      scopedApp: appWithHealth,
      includeLegacy: app.isDefault,
      filters: {
        status: deploymentStatus,
        environment: '',
        app: '',
        source: deploymentSource
      },
      cursor: deploymentCursor || null
    })

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
        (globalEnvVars.R2_ACCESS_KEY ||
          globalEnvVars.S3_ACCESS_KEY ||
          globalEnvVars.SPACES_ACCESS_KEY) &&
        (globalEnvVars.R2_SECRET_KEY ||
          globalEnvVars.S3_SECRET_KEY ||
          globalEnvVars.SPACES_SECRET_KEY) &&
        (globalEnvVars.R2_BUCKET ||
          globalEnvVars.S3_BUCKET ||
          globalEnvVars.SPACES_BUCKET)
      )
    } catch {
      /* ignore */
    }

    // Build inherited vars (global + environment)
    const inheritedVars = { ...globalEnvVars, ...(environment.envVars || {}) }

    // Generate deployment checklist
    const checklist = await sails.helpers.environment.generateChecklist(
      environment.id
    )
    const sourceReadiness = await sails.helpers.deploy.getSourceReadiness.with({
      project,
      environment,
      app
    })

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
        app: {
          ...app,
          containerHealth,
          directAccess,
          primaryUrl,
          accessUrls
        },
        appEnvVars: decryptedApp.envVars || {},
        inheritedVars,
        deploymentHistory,
        services,
        backupConfigured,
        checklist,
        sourceReadiness
      }
    }
  }
}
