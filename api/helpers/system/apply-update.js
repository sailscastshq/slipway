const { createUpdater } = require('../../../bin/slipway-updater.cjs')
module.exports = {
  friendlyName: 'Apply update',
  description:
    'Admit the shared detached updater; the web process never owns the update lifecycle.',
  inputs: {},
  exits: { success: { outputType: 'ref' }, noUpdate: {} },
  fn: async function () {
    const engine = createUpdater({
      binary: sails.config.docker?.binaryPath || 'docker'
    })
    const current = await engine.status()
    if (
      current.operationId &&
      !['success', 'failed', 'rolled-back', 'interrupted'].includes(
        current.phase
      )
    )
      return { ...current, adopted: true }
    const info = await sails.helpers.system.checkForUpdates.with({
      skipCache: true
    })
    if (info.error)
      throw new Error(
        'Update availability could not be confirmed. The current release is unchanged.'
      )
    if (!info.updateAvailable) {
      if (
        current.phase === 'success' &&
        current.targetVersion === info.currentVersion
      )
        return current
      throw 'noUpdate'
    }
    const targetImage = await sails.helpers.system.getUpdateImageRef.with({
      updateInfo: info,
      imageRepository: `ghcr.io/${
        sails.config.slipway?.githubRepo || 'sailscastshq/slipway'
      }`
    })
    return engine.start({
      targetImage,
      targetVersion: info.latestVersion,
      appsDir: sails.config.custom.slipwayAppsDir || '/var/slipway/apps'
    })
  }
}
