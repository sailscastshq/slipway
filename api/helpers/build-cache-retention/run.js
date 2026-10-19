const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const command = promisify(execFile)

module.exports = {
  friendlyName: 'Clean up old build cache',
  description:
    'Prune only unused age-filtered build cache, preserving deployment images and volumes.',
  inputs: { preview: { type: 'boolean', defaultsTo: false } },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ preview = false } = {}) {
    const policy = await sails.helpers.buildCacheRetention.getPolicy()
    const result = {
      runId: randomUUID(),
      startedAt: Date.now(),
      status: 'planning',
      mode: policy.remove && !preview ? 'remove' : 'dry-run',
      policy,
      holds: [],
      before: null,
      after: null,
      filesystemAvailableDeltaBytes: null,
      dockerReportedReclaimed: null,
      error: null
    }
    let release,
      pruneStarted = false,
      pruneCompleted = false,
      preserveGuard = false
    const docker = sails.config.docker?.binaryPath || 'docker'
    try {
      release = await require('../../lib/image-operation-guard').acquire(
        sails.config.appPath,
        'cleanup',
        {
          recovery:
            result.mode === 'remove'
              ? require('../../lib/image-guard-recovery')(sails)
              : undefined
        }
      )
      result.recoveredGuards = release.recoveredCount
      const beforeDisk = await sails.helpers.lookout.getDiskSpace()
      if (!validDisk(beforeDisk))
        return await held('disk-inventory-unavailable')
      result.before = {
        cache: await sails.helpers.buildCacheRetention.getInventory(),
        disk: beforeDisk
      }
      if (await activeWork(result.before.cache))
        return await held('active-build-or-deployment')
      await save()
      await audit('build-cache-retention.planned')
      if (result.mode === 'dry-run') {
        result.status = 'dry-run'
        return await finish()
      }
      const { stdout: help } = await command(
        docker,
        ['builder', 'prune', '--help'],
        { timeout: 15000, maxBuffer: 65536 }
      )
      if (
        ['--all', '--filter', '--keep-storage', '--force'].some(
          (flag) => !help.includes(flag)
        )
      )
        return await held('bounded-cache-prune-unsupported')
      const current = await sails.helpers.buildCacheRetention.getPolicy()
      if (JSON.stringify(current) !== JSON.stringify(policy))
        return await held('policy-changed')
      const fresh = await sails.helpers.buildCacheRetention.getInventory()
      if (await activeWork(fresh))
        return await held('active-build-or-deployment')
      // --force only suppresses this cache command's confirmation prompt. It
      // does not force image deletion; no image/volume/system prune is invoked.
      const args = [
        'builder',
        'prune',
        '--all',
        '--filter',
        `until=${policy.minimumUnusedHours}h`,
        '--keep-storage',
        String(policy.keepStorageBytes),
        '--force'
      ]
      result.status = 'running'
      await save()
      await audit('build-cache-retention.removal-started')
      const remaining = policy.maxRunMs - (Date.now() - result.startedAt)
      if (remaining <= 0) return await held('run-time-limit')
      pruneStarted = true
      const { stdout } = await command(docker, args, {
        timeout: remaining,
        maxBuffer: 1024 * 1024
      })
      pruneCompleted = true
      const reclaimed =
        /^Total(?: reclaimed space)?:\s*([0-9.]+\s*(?:[kMGTPE]?B))\s*$/im.exec(
          stdout
        )
      result.dockerReportedReclaimed = reclaimed?.[1] || null
      const afterDisk = await sails.helpers.lookout.getDiskSpace()
      result.after = {
        cache: await sails.helpers.buildCacheRetention.getInventory(),
        disk: afterDisk
      }
      if (!validDisk(afterDisk))
        throw new Error('Post-cleanup disk inventory unavailable.')
      // This is a measured net change, possibly negative under other workloads.
      // Docker's cache accounting is a separate value, never a freed-byte claim.
      result.filesystemAvailableDeltaBytes =
        afterDisk.availableBytes - beforeDisk.availableBytes
      result.status = 'complete'
      return await finish()
    } catch (error) {
      if (error.code === 'E_IMAGE_OPERATIONS_BUSY')
        return await held(error.reason || 'image-operation-guard-present')
      preserveGuard = pruneStarted && !pruneCompleted
      result.status = preserveGuard ? 'unconfirmed' : 'failed'
      if (preserveGuard)
        result.holds = ['build-cache-cleanup-outcome-unconfirmed']
      result.error = preserveGuard
        ? 'Cache cleanup completion is unconfirmed; preserve its guard and inspect the daemon before resuming deployments.'
        : 'Build cache cleanup failed; inspect the bounded audit outcome.'
      await finish()
      throw new Error(result.error, { cause: error })
    } finally {
      if (release && !preserveGuard) await release()
    }
    async function held(reason) {
      result.status = 'held'
      result.holds = [reason]
      return finish()
    }
    async function activeWork(cache) {
      return (
        cache.active > 0 ||
        (await DeploymentJob.count({
          stage: { nin: ['complete', 'failed', 'cancelled'] }
        })) > 0
      )
    }
    async function audit(action) {
      await AuditLog.create({
        action,
        resourceType: 'build-cache-retention',
        resourceId: result.runId,
        details: result,
        user: null,
        team: null
      })
    }
    async function save() {
      await sails.helpers.setting.set(
        'buildCacheRetentionLastRun',
        JSON.stringify(result)
      )
    }
    async function finish() {
      result.finishedAt = Date.now()
      const summary = {
        status: result.status,
        mode: result.mode,
        holds: result.holds,
        recoveredGuards: result.recoveredGuards || 0,
        minimumUnusedHours: policy.minimumUnusedHours,
        keepStorageBytes: policy.keepStorageBytes,
        cacheBefore: result.before?.cache || null,
        cacheAfter: result.after?.cache || null,
        dockerReportedReclaimed: result.dockerReportedReclaimed,
        filesystemAvailableDeltaBytes: result.filesystemAvailableDeltaBytes,
        measurement:
          'Observed net filesystem availability change; Docker accounting is not physical space reclaimed.'
      }
      result.summary = summary
      await save()
      await audit('build-cache-retention.finished')
      sails.log.info(
        `Clean up old build cache: ${summary.status} (${summary.mode}); holds ${
          summary.holds.join(', ') || 'none'
        }; observed filesystem available-byte change ${
          summary.filesystemAvailableDeltaBytes ?? 'not measured'
        }; Docker accounting ${
          summary.dockerReportedReclaimed || 'not reported'
        }.`
      )
      return summary
    }
  }
}
function validDisk(value) {
  return (
    value &&
    Number.isSafeInteger(value.availableBytes) &&
    value.availableBytes >= 0 &&
    Number.isSafeInteger(value.totalBytes) &&
    value.totalBytes > 0 &&
    value.availableBytes <= value.totalBytes
  )
}
