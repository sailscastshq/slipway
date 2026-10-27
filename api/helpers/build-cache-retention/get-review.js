const fs = require('node:fs/promises')
const path = require('node:path')
const workspace = require('../../lib/instance-quest-workspace')

module.exports = {
  friendlyName: 'Review host build cache cleanup',
  description:
    'Read policy, cache accounting and retained job state without pruning.',
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    const policy = await sails.helpers.buildCacheRetention.getPolicy()
    const snapshot = sails.instanceQuest
      ? await sails.instanceQuest.snapshot()
      : { jobs: [], runs: [] }
    const job = snapshot.jobs.find((item) => item.name === 'retain-build-cache')
    const source = snapshot.runs.find(
      (item) => item.name === 'retain-build-cache'
    )
    const holds = []
    let cache = null
    try {
      cache = await sails.helpers.buildCacheRetention.getInventory()
      if (cache.active > 0) holds.push('A Docker build is using cache.')
    } catch {
      holds.push(
        'Docker cache inventory is unavailable. Try again when Docker is reachable.'
      )
    }
    if (!policy.remove)
      holds.push('Build cache removal is disabled in instance configuration.')
    if (!job?.manualAllowed)
      holds.push('The cleanup job is running, paused or unavailable.')
    if (
      await DeploymentJob.count({
        stage: { nin: ['complete', 'failed', 'cancelled'] }
      })
    )
      holds.push('Wait for current deployments to finish.')
    try {
      const entries = await fs.readdir(
        path.join(sails.config.appPath, 'db', 'image-operation-guard')
      )
      if (entries.length)
        holds.push(
          'A deployment, update or maintenance operation holds disk cleanup.'
        )
    } catch (error) {
      if (error.code !== 'ENOENT')
        holds.push('Maintenance ownership could not be verified.')
    }
    try {
      const update = await sails.helpers.buildCacheRetention.getUpdateStatus()
      if (
        !update ||
        typeof update.phase !== 'string' ||
        update.maintenanceBusy === true ||
        !['idle', 'success', 'failed', 'rolled-back'].includes(update.phase)
      )
        holds.push('Wait for the Slipway update to finish.')
    } catch {
      holds.push('Update ownership could not be verified.')
    }
    const disk = await sails.helpers.lookout.getDiskSpace()
    if (
      !disk ||
      !Number.isSafeInteger(disk.availableBytes) ||
      !Number.isSafeInteger(disk.totalBytes) ||
      disk.availableBytes < 0 ||
      disk.totalBytes <= 0 ||
      disk.availableBytes > disk.totalBytes
    )
      holds.push('Host disk measurements are unavailable.')
    return {
      policy,
      cache,
      holds,
      available: holds.length === 0,
      cleanupProgress: source
        ? await require('../../lib/cache-cleanup-progress').read(
            sails,
            source.id
          )
        : null,
      run: source ? workspace.normalizeRun(source) : null,
      hostDisk: disk,
      observedAt: Date.now()
    }
  }
}
