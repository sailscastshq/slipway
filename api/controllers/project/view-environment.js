module.exports = {
  friendlyName: 'View environment',

  description:
    'Display environment detail page with env vars, services, and deployments.',

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
    deploymentStatus: {
      type: 'string'
    },
    deploymentApp: {
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
    deploymentStatus,
    deploymentApp,
    deploymentSource,
    deploymentCursor
  }) {
    const {
      getPublicMatrix,
      inspectVersion
    } = require('../../lib/service-image-policy')
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({
      slug: envSlug,
      project: project.id
    })
      .populate('services')
      .decrypt()

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Get all app records (multi-app support)
    let allApps = await App.find({ environment: environment.id })
    let app = allApps.find((a) => a.isDefault) || allApps[0] || null

    const { fullDomain, generatedDomain, domains } =
      await Environment.resolveDomains(environment.id)
    const serverIp = await sails.helpers.getServerIp()

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
          backupSupported: Service.isBackupSupported(service.type),
          versionSupport: getVersionSupport(service)
        }
      })
    )

    // Check if backup storage is configured
    let backupConfigured = false
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      const globalVars = JSON.parse(globalJson)
      backupConfigured = !!(
        (globalVars.R2_ACCESS_KEY ||
          globalVars.S3_ACCESS_KEY ||
          globalVars.SPACES_ACCESS_KEY) &&
        (globalVars.R2_SECRET_KEY ||
          globalVars.S3_SECRET_KEY ||
          globalVars.SPACES_SECRET_KEY) &&
        (globalVars.R2_BUCKET ||
          globalVars.S3_BUCKET ||
          globalVars.SPACES_BUCKET)
      )
    } catch {
      /* ignore */
    }

    // Check container status for all apps
    const appsWithHealth = []
    for (const a of allApps) {
      let containerExists = false
      let containerHealth = null
      if (a.containerName) {
        try {
          const containerStatus = await sails.helpers.docker.getContainerStatus(
            a.containerName
          )
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
    app = appsWithHealth.find((a) => a.isDefault) || appsWithHealth[0] || null

    const deploymentHistory = await sails.helpers.deployment.getHistory.with({
      projectSlug: project.slug,
      environments: [environment],
      apps: appsWithHealth,
      currentApps: appsWithHealth,
      filters: {
        status: deploymentStatus,
        environment: '',
        app: deploymentApp,
        source: deploymentSource
      },
      cursor: deploymentCursor || null
    })

    // Generate deployment checklist
    const checklist = await sails.helpers.environment.generateChecklist(
      environment.id
    )
    const managedEnvVarKeys = (environment.services || [])
      .map((service) => service.envVarKey)
      .filter(Boolean)
    const envVarMetadata =
      sails.helpers.configuration.normalizeEnvVarMetadata.with({
        values: environment.envVars || {},
        metadata: environment.envVarMetadata || {},
        currentValues: environment.envVars || {},
        currentMetadata: environment.envVarMetadata || {},
        managedKeys: managedEnvVarKeys,
        recordChanges: false
      })

    // Check if GitHub is connected for this team
    const gitProvider = await GitProvider.findOne({
      team: user.team.id,
      type: 'github',
      isActive: true
    })
    const githubConnected = !!gitProvider
    const sourceReadinessByApp = {}
    for (const appRecord of appsWithHealth) {
      sourceReadinessByApp[appRecord.id] =
        await sails.helpers.deploy.getSourceReadiness.with({
          project,
          environment,
          app: appRecord
        })
    }
    const publicEnvironment = omitPrivateEnvironmentFields(environment)

    return {
      page: 'projects/environment',
      props: {
        project,
        environment: {
          ...publicEnvironment,
          fullDomain,
          generatedDomain,
          domains,
          serverIp,
          services
        },
        app: app ? omitPrivateAppFields(app) : null,
        apps: appsWithHealth.map(omitPrivateAppFields),
        envVars: environment.envVars || {},
        envVarMetadata,
        deploymentHistory,
        checklist,
        serviceVersions: getPublicMatrix(),
        backupConfigured,
        githubConnected,
        sourceReadinessByApp
      }
    }

    function getVersionSupport(service) {
      try {
        return inspectVersion(service.type, service.version, {
          useDefault: false
        }).supported
          ? 'supported'
          : 'custom'
      } catch {
        return 'unresolved'
      }
    }
  }
}

function omitPrivateEnvironmentFields(environment) {
  const {
    envVars,
    envVarMetadata,
    telemetryToken,
    telemetryTokenHash,
    ...publicEnvironment
  } = environment
  return publicEnvironment
}

function omitPrivateAppFields(app) {
  const {
    envVars,
    secureEnvVars,
    envVarMetadata,
    bridgeSecret,
    bearingSecret,
    ...publicApp
  } = app
  return publicApp
}
