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
        upgrade = require('../../lib/upgrade-host-review').status(upgradeId)
      } catch {
        upgrade = { id: upgradeId, recoveryRequired: true }
      }
    }
    if (!upgradeId && sails.upgradeAdmission) {
      try {
        upgrade = require('../../lib/upgrade-host-review').status()
      } catch {
        upgrade = { recoveryRequired: true }
      }
    }
    return {
      page: 'settings/update',
      props: {
        updateInfo,
        coordinated: Boolean(sails.upgradeAdmission),
        hostNative:
          Boolean(sails.upgradeAdmission) ||
          (/^\d+\.\d+\.\d+$/.test(updateInfo.latestVersion || '') &&
            require('semver').gte(updateInfo.latestVersion, '0.0.88')),
        upgrade
      }
    }
  }
}
