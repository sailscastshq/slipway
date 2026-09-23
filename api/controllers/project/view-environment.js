function once(callback) {
  let pending
  return () => (pending ||= Promise.resolve().then(callback))
}

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
    const user = await User.forRequest(this.req, { populateTeam: true })

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

    const loadAllApps = once(() => App.find({ environment: environment.id }))
    const loadDomains = once(() => Environment.resolveDomains(environment.id))
    const loadServerIp = once(() => sails.helpers.getServerIp())
    const loadServices = once(() =>
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
            backupSupported: Service.isBackupSupported(service.type),
            versionSupport: getVersionSupport(service)
          }
        })
      )
    )
    const loadAppsWithHealth = once(async () => {
      const allApps = await loadAllApps()
      const appsWithHealth = []
      for (const a of allApps) {
        let containerExists = false
        let containerHealth = null
        if (a.containerName) {
          try {
            const containerStatus =
              await sails.helpers.docker.getContainerStatus(a.containerName)
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
      return appsWithHealth
    })
    const publicEnvironment = omitPrivateEnvironmentFields(environment)

    return {
      page: 'projects/environment',
      props: {
        project,
        environment: async () => {
          const [{ fullDomain, generatedDomain, domains }, serverIp, services] =
            await Promise.all([loadDomains(), loadServerIp(), loadServices()])
          return {
            ...publicEnvironment,
            fullDomain,
            generatedDomain,
            domains,
            serverIp,
            services
          }
        },
        app: async () => {
          const apps = await loadAppsWithHealth()
          const app = apps.find((item) => item.isDefault) || apps[0] || null
          return app ? omitPrivateAppFields(app) : null
        },
        apps: async () =>
          (await loadAppsWithHealth()).map(omitPrivateAppFields),
        envVars: require('../../lib/external-postgresql').redactEnv(
          environment.envVars || {},
          environment.services
        ),
        envVarMetadata: () => {
          const managedEnvVarKeys = (environment.services || [])
            .map((service) => service.envVarKey)
            .filter(Boolean)
          return sails.helpers.configuration.normalizeEnvVarMetadata.with({
            values: environment.envVars || {},
            metadata: environment.envVarMetadata || {},
            currentValues: environment.envVars || {},
            currentMetadata: environment.envVarMetadata || {},
            managedKeys: managedEnvVarKeys,
            recordChanges: false
          })
        },
        deploymentHistory: async () => {
          const appsWithHealth = await loadAppsWithHealth()
          return sails.helpers.deployment.getHistory.with({
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
        },
        readiness: () =>
          sails.helpers.environment.getReadiness.with({
            environmentId: environment.id
          }),
        serviceVersions: getPublicMatrix,
        backupConfigured: async () => {
          try {
            await sails.helpers.backup.getStorageConfig()
            return true
          } catch {
            return false
          }
        },
        githubConnected: async () =>
          Boolean(
            await GitProvider.findOne({
              team: user.team.id,
              type: 'github',
              isActive: true
            })
          ),
        sourceReadinessByApp: async () => {
          const sourceReadinessByApp = {}
          for (const appRecord of await loadAppsWithHealth()) {
            sourceReadinessByApp[appRecord.id] =
              await sails.helpers.deploy.getSourceReadiness.with({
                project,
                environment,
                app: appRecord
              })
          }
          return sourceReadinessByApp
        }
      }
    }

    function getVersionSupport(service) {
      if (service.type === 'custom') return 'custom-image'
      if (service.managementMode === 'external') return 'external'
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
