const { getUpgradePlan } = require('../../../../lib/service-image-policy')

module.exports = {
  friendlyName: 'Upgrade service',

  description: 'Start a guarded service version upgrade.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true
    },
    targetVersion: {
      type: 'string',
      required: true
    },
    confirmation: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      statusCode: 202
    },
    notFound: {
      statusCode: 404
    },
    badRequest: {
      statusCode: 400
    }
  },

  fn: async function ({ serviceId, targetVersion, confirmation }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    const service = await Service.findOne({ id: serviceId }).populate(
      'environment'
    )
    if (!service) throw 'notFound'

    const environment = await Environment.findOne({
      id: service.environment.id
    }).populate('project')
    const project = await Project.findOne({ id: environment.project.id })
    if (!project || project.team !== user.team.id) throw 'notFound'

    if (confirmation !== service.name) {
      throw {
        badRequest: {
          message: `Type ${service.name} to confirm the upgrade.`
        }
      }
    }
    if (service.status !== 'running') {
      throw {
        badRequest: {
          message: 'The service must be running before it can be upgraded.'
        }
      }
    }
    if (!service.imageReference || service.version === 'latest') {
      throw {
        badRequest: {
          message:
            'Slipway must resolve the current service image before it can plan an upgrade.'
        }
      }
    }
    if (!Service.isBackupSupported(service.type)) {
      throw {
        badRequest: {
          message:
            'Automated upgrades are disabled until this service type supports verified backups.'
        }
      }
    }

    try {
      getUpgradePlan(service.type, service.version, targetVersion)
    } catch (error) {
      throw { badRequest: { message: error.message } }
    }

    const initialState = {
      status: 'queued',
      fromVersion: service.version,
      targetVersion,
      step: 'backup',
      message: 'Upgrade queued.',
      startedAt: Date.now()
    }
    const claimed = await Service.updateOne({
      id: service.id,
      status: 'running'
    }).set({
      status: 'upgrading',
      upgradeState: initialState
    })
    if (!claimed) {
      throw {
        badRequest: {
          message: 'Another service operation started before the upgrade.'
        }
      }
    }

    sails.helpers.service.runVersionUpgrade
      .with({
        serviceId: service.id,
        targetVersion,
        userId: user.id,
        teamId: user.team.id,
        ipAddress: this.req.ip || null
      })
      .catch(async (error) => {
        const failedState = {
          ...initialState,
          status: 'failed',
          message: `Upgrade worker stopped before it could begin: ${error.message}`,
          failedAt: Date.now()
        }

        try {
          await Service.updateOne({
            id: service.id,
            status: 'upgrading'
          }).set({
            status: 'running',
            upgradeState: failedState
          })
          sails.sse.publish(`service-upgrade:${service.id}`, failedState)
        } catch (stateError) {
          sails.log.error(
            `Could not recover service upgrade state: ${stateError.message}`
          )
        }

        sails.log.error(`Service upgrade worker failed: ${error.message}`)
      })

    return { upgrade: initialState }
  }
}
