module.exports = {
  friendlyName: 'Restore backup',

  description: 'Restore a backup into its original service.',

  inputs: {
    writesPaused: { type: 'boolean', defaultsTo: false },
    backupId: {
      type: 'string',
      required: true,
      description: 'Backup ID to restore'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ backupId, writesPaused }) {
    const user = await User.forRequest(this.req)

    const backup = await Backup.findOne({ id: backupId }).populate('service')
    if (!backup) {
      throw {
        badRequest: {
          problems: [{ backupId: 'That backup is no longer available.' }]
        }
      }
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
      throw {
        badRequest: {
          problems: [{ backupId: 'You do not have access to that backup.' }]
        }
      }
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

    if (!writesPaused)
      throw {
        badRequest: {
          problems: [
            {
              writesPaused:
                'Pause application and external database writes, then confirm they are paused before restoring.'
            }
          ]
        }
      }
    let operation
    try {
      operation = await require('../../lib/restore-operations').enqueue({
        backup,
        service: backup.service,
        teamId: project.team.id,
        userId: user.id
      })
    } catch (error) {
      throw { badRequest: { problems: [{ service: error.message }] } }
    }
    sails.inertia.flash(
      'success',
      `Restore ${operation.id} queued. Keep writes paused until it completes.`
    )
    return `/projects/${project.slug}/environments/${environment.slug}/services/${backup.service.id}`
  }
}
