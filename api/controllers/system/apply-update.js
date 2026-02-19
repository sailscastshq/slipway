module.exports = {
  friendlyName: 'Apply update',

  description:
    'Trigger a Slipway self-update. Returns 202 immediately; the update pipeline runs asynchronously. Connect to GET /api/v1/system/stream-update for real-time progress.',

  inputs: {},

  exits: {
    success: {
      description: 'Update pipeline started.',
      statusCode: 202
    },
    badRequest: {
      responseType: 'badRequest',
      description: 'Already running the latest version or update already in progress.'
    }
  },

  fn: async function () {
    // Prevent concurrent updates
    const progress = await sails.cache.get('slipway_update_progress')
    if (progress && !['idle', 'failed'].includes(progress.phase)) {
      throw {
        badRequest: {
          message: 'An update is already in progress.'
        }
      }
    }

    // Verify an update is available before going async
    const updateInfo = await sails.helpers.system.checkForUpdates()
    if (!updateInfo.updateAvailable) {
      throw {
        badRequest: {
          message: 'Already running the latest version.'
        }
      }
    }

    // Kick off the update pipeline asynchronously
    process.nextTick(async () => {
      try {
        await sails.helpers.system.applyUpdate()
      } catch (err) {
        sails.log.error(`[slipway] Update pipeline failed: ${err.message || err}`)
      }
    })

    return {
      status: 'started',
      currentVersion: updateInfo.currentVersion,
      targetVersion: updateInfo.latestVersion
    }
  }
}
