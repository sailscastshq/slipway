const domainReadiness = require('../../lib/domain-readiness')

function once(callback) {
  let pending
  return () => (pending ||= Promise.resolve().then(callback))
}

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
    const user = await User.forRequest(this.req, { populateTeam: true })

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

    const loadContainerState = once(async () => {
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
      return { containerHealth, containerStatus }
    })
    const loadAccess = once(async () => {
      const { containerHealth, containerStatus } = await loadContainerState()
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
              host: sails.config.custom.slipwayPortHost || '127.0.0.1'
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
      return {
        containerHealth,
        directAccess,
        serverIp,
        fullDomain,
        generatedDomain,
        domains,
        primaryUrl,
        accessUrls
      }
    })

    const loadDeploymentHistory = async () => {
      const { containerHealth } = await loadContainerState()
      const appWithHealth = { ...app, containerHealth }
      return sails.helpers.deployment.getHistory.with({
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
    }

    // Enrich services with connection URLs and last backup
    const loadServices = () =>
      Promise.all(
        (environment.services || []).map(async (service) => {
          const connectionUrl =
            service.managementMode === 'external'
              ? null
              : await Service.getConnectionUrl(service.id)
          let lastBackup = null
          if (Service.isBackupSupported(service.type)) {
            const backups = await Backup.find({ service: service.id })
              .sort('createdAt DESC')
              .limit(1)
            const latest = backups[0]
            lastBackup = latest
              ? {
                  id: latest.id,
                  status: latest.status,
                  completedAt: latest.completedAt,
                  sizeBytes: latest.sizeBytes
                }
              : null
          }
          return {
            ...Service.toPublic(service),
            connectionUrl,
            lastBackup,
            backupSupported: Service.isBackupSupported(service.type)
          }
        })
      )

    // Check if backup storage is configured
    // Inertia resolves only requested props on partial reloads. Keep unrelated
    // deployment, service, and configuration work out of focused refreshes.
    const loadDecryptedApp = once(() => App.findOne({ id: app.id }).decrypt())
    const loadBackupSettings = once(async () => {
      let backupConfigured = false
      let globalEnvVars = {}
      try {
        const globalJson = await sails.helpers.setting.get(
          'globalEnvVars',
          '{}'
        )
        globalEnvVars = JSON.parse(globalJson)
        await sails.helpers.backup.getStorageConfig()
        backupConfigured = true
      } catch {
        /* ignore */
      }
      return { backupConfigured, globalEnvVars }
    })
    const loadEnrichedServices = once(loadServices)
    const publicEnvironment = omitPrivateEnvironmentFields(environment)

    return {
      page: 'projects/app',
      props: {
        project,
        environment: async () => {
          const { fullDomain, generatedDomain, domains, serverIp } =
            await loadAccess()
          return {
            ...publicEnvironment,
            fullDomain,
            generatedDomain,
            domains,
            serverIp,
            domainReadiness: domainReadiness({
              domain: environment.domain,
              serverIp
            }),
            services: await loadEnrichedServices()
          }
        },
        app: async () => {
          const { containerHealth, directAccess, primaryUrl, accessUrls } =
            await loadAccess()
          const bridgeUrl = await sails.helpers.bridge.getAppUrl.with({
            app,
            environment,
            project
          })
          return {
            ...omitPrivateAppFields(app),
            containerHealth,
            directAccess,
            primaryUrl,
            accessUrls,
            bridgeUrl: bridgeUrl ? `${bridgeUrl}/bridge` : null
          }
        },
        appEnvVars: async () => {
          const decryptedApp = await loadDecryptedApp()
          return decryptedApp.secureEnvVars || decryptedApp.envVars || {}
        },
        appEnvVarMetadata: async () => {
          const decryptedApp = await loadDecryptedApp()
          return sails.helpers.configuration.normalizeEnvVarMetadata.with({
            values: decryptedApp.secureEnvVars || decryptedApp.envVars || {},
            metadata: decryptedApp.envVarMetadata || {},
            currentValues:
              decryptedApp.secureEnvVars || decryptedApp.envVars || {},
            currentMetadata: decryptedApp.envVarMetadata || {},
            recordChanges: false
          })
        },
        inheritedVars: async () => {
          const { globalEnvVars } = await loadBackupSettings()
          return require('../../lib/external-postgresql').redactEnv(
            { ...globalEnvVars, ...(environment.envVars || {}) },
            environment.services
          )
        },
        deploymentHistory: loadDeploymentHistory,
        services: loadEnrichedServices,
        backupConfigured: async () =>
          (await loadBackupSettings()).backupConfigured,
        readiness: () =>
          sails.helpers.environment.getReadiness.with({
            environmentId: environment.id,
            appId: app.id
          }),
        sourceReadiness: () =>
          sails.helpers.deploy.getSourceReadiness.with({
            project,
            environment,
            app
          }),
        releaseFlags: async () =>
          (
            await FeatureFlag.find({
              environment: environment.id,
              app: app.id
            }).sort('key ASC')
          ).map((flag) => sails.helpers.flag.present(flag)),
        canManageBridge: ['owner', 'admin'].includes(user.teamRole),
        canManageBearing: ['owner', 'admin'].includes(user.teamRole)
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
