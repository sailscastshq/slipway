module.exports = {
  friendlyName: 'Restore backup',

  description: 'Restore a backup into its original service.',

  inputs: {
    backupId: {
      type: 'string',
      required: true,
      description: 'Backup ID to restore'
    }
  },

  exits: {
    success: {
      statusCode: 202
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

  fn: async function ({ backupId }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const backup = await Backup.findOne({ id: backupId }).populate('service')
    if (!backup) {
      throw 'notFound'
    }

    if (!backup.service) {
      throw {
        badRequest: {
          problems: [{ service: 'Backup service no longer exists.' }]
        }
      }
    }

    // Check access
    const environment = await Environment.findOne({
      id: backup.service.environment
    }).populate('project')
    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    if (backup.status !== 'completed') {
      throw {
        badRequest: {
          problems: [{ status: 'Only completed backups can be restored.' }]
        }
      }
    }

    if (backup.service.status !== 'running') {
      throw {
        badRequest: {
          problems: [
            { service: 'Service must be running to restore a backup.' }
          ]
        }
      }
    }

    // Audit log
    await sails.helpers.audit.log.with({
      action: 'backup.restored',
      resourceType: 'backup',
      resourceId: backup.id,
      details: {
        serviceName: backup.service.name,
        serviceType: backup.service.type
      },
      userId: user.id,
      teamId: project.team.id,
      ipAddress: this.req.ip
    })

    // Run restore asynchronously
    sails.helpers.backup
      .restoreBackup(backup.id)
      .then(() => sails.log.info(`Backup ${backup.id} restored successfully`))
      .catch((err) => sails.log.error(`Backup restore failed: ${err.message}`))

    return {
      message: 'Restore started',
      backupId: backup.id
    }
  }
}
