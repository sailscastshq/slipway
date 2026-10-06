module.exports = {
  friendlyName: 'View update',

  description: 'Display the update status and instructions page.',

  inputs: { upgradeId: { type: 'string' } },

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function ({ upgradeId } = {}) {
    const updateInfo = await sails.helpers.system.checkForUpdates()

    let upgrade = null
    if (upgradeId) {
      try {
        const broker = await require('../../lib/system-upgrade-action').broker(
          this.req
        )
        upgrade = broker.status(upgradeId)
        this.res.once('finish', () => {
          broker
            .start(upgradeId)
            .catch(() =>
              sails.log.warn(
                'Upgrade dispatch outcome is unconfirmed; inspect the saved checkpoint.'
              )
            )
        })
      } catch {
        upgrade = { id: upgradeId, recoveryRequired: true }
      }
    }
    if (!upgradeId && sails.upgradeAdmission) {
      try {
        upgrade = (
          await require('../../lib/system-upgrade-action').broker(this.req)
        ).latest()
      } catch {
        upgrade = { recoveryRequired: true }
      }
    }
    return {
      page: 'settings/update',
      props: {
        updateInfo,
        coordinated: Boolean(sails.upgradeAdmission),
        upgrade
      }
    }
  }
}
