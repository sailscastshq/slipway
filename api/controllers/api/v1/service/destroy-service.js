module.exports = {
  friendlyName: 'Delete service',

  description: 'Run the shared, resumable cleanup for a service.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Service ID'
    },
    purgeData: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    cleanupFailed: {
      statusCode: 409,
      description: 'Cleanup paused and can be resumed'
    }
  },

  fn: async function ({ id, purgeData }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const requestKey = `service:${id}`
    const targetKey = `service:${id}`
    const [service, existingOperation] = await Promise.all([
      Service.findOne({ id }),
      sails.helpers.cleanup.findOperation.with({ targetKey, requestKey })
    ])
    if (!service && !existingOperation) throw 'notFound'

    let project
    let environment
    if (service) {
      environment = await Environment.findOne({
        id: service.environment
      }).populate('project')
      project = await Project.findOne({
        id: environment.project.id
      }).populate('team')
    } else {
      project = await Project.findOne({
        id: existingOperation.projectId
      }).populate('team')
    }

    const teamId = project?.team?.id || existingOperation.team
    if (Number(teamId) !== Number(user.team)) throw 'forbidden'
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    try {
      const cleanup = await sails.helpers.cleanup.run.with({
        targetKey,
        requestKey,
        scopeType: 'service',
        resourceId: service?.id || existingOperation.resourceId,
        retentionPolicy: purgeData ? 'purge' : 'retain',
        userId: user.id,
        teamId,
        ipAddress: this.req.ip
      })

      sails.log.info(
        `Service ${service?.name || cleanup.label} deleted from ${
          project?.slug || cleanup.targetKey
        }`
      )
      return {
        message: 'Service deleted successfully',
        cleanup
      }
    } catch (error) {
      throw {
        cleanupFailed: {
          message: error.message,
          cleanup: error.cleanup || null
        }
      }
    }
  }
}
