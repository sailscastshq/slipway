module.exports = {
  friendlyName: 'Create backup',

  description: 'Trigger a manual database backup for a service.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service ID to back up'
    }
  },

  exits: {
    success: {
      statusCode: 201
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ serviceId }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const service = await Service.findOne({ id: serviceId }).populate('environment').decrypt()
    if (!service) {
      throw 'notFound'
    }

    const environment = await Environment.findOne({ id: service.environment.id }).populate('project')
    const project = await Project.findOne({ id: environment.project.id }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Only database services support backups (not Redis)
    if (!Service.isBackupSupported(service.type)) {
      throw {
        badRequest: {
          problems: [{ type: `Backups are not supported for ${service.type} services.` }]
        }
      }
    }

    // Check service is running
    if (service.status !== 'running') {
      throw {
        badRequest: {
          problems: [{ status: 'Service must be running to create a backup.' }]
        }
      }
    }

    // Create backup record
    const backup = await Backup.create({
      status: 'pending',
      type: 'manual',
      service: service.id,
      triggeredBy: user.id
    }).fetch()

    // Audit log
    sails.helpers.audit.log.with({
      action: 'backup.created',
      resourceType: 'backup',
      resourceId: backup.id,
      details: { serviceName: service.name, serviceType: service.type },
      userId: user.id,
      teamId: project.team.id,
      ipAddress: this.req.ip
    }).intercept(() => {}) // fire-and-forget

    // Run backup asynchronously (fire-and-forget using Sails helper callback)
    // Note: this is sails.helpers.*.exec(), NOT child_process.exec()
    sails.helpers.backup.runBackup(backup.id)
      .then(() => {})
      .catch((err) => sails.log.error('Backup helper error:', err.message))

    return {
      backup: {
        id: backup.id,
        status: backup.status,
        type: backup.type,
        createdAt: backup.createdAt
      }
    }
  }
}
