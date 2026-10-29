const workspace = require('../../lib/instance-quest-workspace')
const guard = require('../../lib/image-operation-guard')

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
    const ownership = await guard.inspect(sails.config.appPath)
    if (ownership.state === 'recoverable') {
      if (!(await require('../../lib/image-guard-recovery')(sails).prepare()))
        holds.push(
          'Stopped guard owners were found, but safe recovery checks are not clear. Review deployments and maintenance before retrying.'
        )
    } else if (ownership.state === 'cleanup')
      holds.push(
        'A maintenance cleanup guard is retained. Inspect its outcome before retrying; no automatic unlock is performed.'
      )
    else if (ownership.state === 'busy')
      holds.push('Disk operation admission is busy. Review again shortly.')
    else if (ownership.state === 'active')
      holds.push(
        'A live process still owns a disk guard. Review deployments or maintenance before retrying.'
      )
    else if (ownership.state !== 'clear')
      holds.push(
        'Disk guard ownership could not be verified. An administrator must inspect retained guards and host processes; no automatic unlock is performed.'
      )
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
      ownership,
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
