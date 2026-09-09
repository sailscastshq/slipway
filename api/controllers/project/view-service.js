module.exports = {
  friendlyName: 'View service',

  description: 'Display the service detail page.',

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
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service ID'
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

  fn: async function ({ slug, envSlug, serviceId }) {
    const user = await User.forRequest(this.req, { populateTeam: true })

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    const service = await Service.findOne({
      id: serviceId,
      environment: environment.id
    })

    if (!service) {
      throw { notFound: `/projects/${slug}/environments/${envSlug}?services` }
    }

    // Get connection URL
    const connectionUrl =
      service.managementMode === 'external'
        ? null
        : await Service.getConnectionUrl(service.id)

    // Get last backup if supported
    let lastBackup = null
    if (Service.isBackupSupported(service.type)) {
      const backups = await Backup.find({
        service: service.id
      })
        .sort('createdAt DESC')
        .limit(1)
      lastBackup = backups[0] || null
    }

    const [restoreOperation] = await RestoreOperation.find({
      service: service.id
    })
      .sort('id DESC')
      .limit(1)

    return {
      page: 'projects/service',
      props: {
        restoreOperation: restoreOperation || null,
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug
        },
        service: {
          id: service.id,
          managementMode: service.managementMode,
          externalVerification: service.externalVerification,
          externalTlsMode: service.externalVerification?.tlsMode || null,
          envVarKey: service.envVarKey,
          name: service.name,
          type: service.type,
          version: service.version,
          status: service.status,
          containerName: service.containerName,
          connectionUrl,
          internalHost: service.internalHost,
          internalPort: service.internalPort,
          database: service.database,
          username: service.username,
          envVarKey: service.envVarKey,
          backupSupported: Service.isBackupSupported(service.type),
          lastBackup: lastBackup
            ? {
                id: lastBackup.id,
                status: lastBackup.status,
                completedAt: lastBackup.completedAt,
                sizeBytes: lastBackup.sizeBytes
              }
            : null
        }
      }
    }
  }
}
