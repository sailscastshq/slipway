module.exports = {
  friendlyName: 'Check for updates',

  description:
    'Periodically check GitHub releases for new Slipway versions and cache the result.',

  quest: {
    interval: 'every 1 hour'
  },

  fn: async function () {
    if (sails.config.slipway?.showUpdateNotifications === false) {
      sails.log.verbose('Update notifications disabled, skipping check')
      return
    }

    const result = await sails.helpers.system.checkForUpdates()

    if (result.updateAvailable) {
      sails.log.info(
        `[slipway] Update available: ${result.currentVersion} → ${result.latestVersion} (${result.imageRef})`
      )
    } else if (result.error) {
      sails.log.verbose(`[slipway] Update check: ${result.error}`)
    } else {
      sails.log.verbose(`[slipway] Up to date (${result.currentVersion})`)
    }
  }
}
