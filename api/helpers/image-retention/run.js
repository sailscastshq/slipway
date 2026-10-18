const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

module.exports = {
  friendlyName: 'Run deployment image retention',
  description:
    'Plan or explicitly opt into bounded image removal under one shared instance lock.',
  inputs: {},
  exits: { success: { outputType: 'ref' } },

  fn: async function () {
    const lockPath = path.join(
      sails.config.appPath,
      'db',
      'image-retention.lock'
    )
    const token = randomUUID()
    let lock
    let releaseImages
    try {
      lock = await fs.open(lockPath, 'wx', 0o600)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      return {
        status: 'busy',
        removed: [],
        skipped: [],
        reason: 'Another image retention run owns the instance lock'
      }
    }
    const result = {
      runId: token,
      startedAt: Date.now(),
      status: 'planning',
      removed: [],
      skipped: [],
      failed: []
    }
    try {
      await lock.writeFile(
        JSON.stringify({ token, pid: process.pid, startedAt: result.startedAt })
      )
      releaseImages = await require('../../lib/image-operation-guard').acquire(
        sails.config.appPath,
        'cleanup'
      )
      const policy = await sails.helpers.imageRetention.getPolicy()
      result.mode = policy.remove ? 'remove' : 'dry-run'
      result.policy = policy
      const inventory = await sails.helpers.imageRetention.getInventory.with({
        policy
      })
      const plan = await sails.helpers.imageRetention.getPlan.with({
        inventory,
        policy
      })
      result.plan = plan
      result.status = plan.status === 'held' ? 'held' : 'dry-run'
      // Require a durable plan and audit record before any possible mutation.
      await save()
      await audit('image-retention.planned', {
        mode: result.mode,
        policy,
        plan
      })
      if (plan.status === 'held' || !policy.remove) return await finish()

      result.status = 'running'
      for (const candidate of plan.candidates.slice(0, policy.maxRemovals)) {
        if (Date.now() - result.startedAt >= policy.maxRunMs) {
          result.skipped.push({ id: candidate.id, reason: 'run-time-limit' })
          break
        }
        const currentPolicy = await sails.helpers.imageRetention.getPolicy()
        if (JSON.stringify(currentPolicy) !== JSON.stringify(policy))
          throw new Error('Image retention policy changed during the run')
        // Re-read both Docker and database references for every exact-ID removal.
        const freshInventory =
          await sails.helpers.imageRetention.getInventory.with({ policy })
        const freshPlan = await sails.helpers.imageRetention.getPlan.with({
          inventory: freshInventory,
          policy
        })
        if (freshPlan.status === 'held') {
          result.status = 'held'
          result.holds = freshPlan.holds
          break
        }
        if (!freshPlan.candidates.some((image) => image.id === candidate.id)) {
          result.skipped.push({
            id: candidate.id,
            reason: 'protection-or-inventory-changed'
          })
          continue
        }
        await audit('image-retention.removal-started', {
          imageId: candidate.id
        })
        try {
          await sails.helpers.imageRetention.removeImage.with({
            imageId: candidate.id
          })
        } catch (error) {
          result.failed.push({
            id: candidate.id,
            reason: 'docker-removal-failed'
          })
          throw error
        }
        result.removed.push(candidate.id)
        await save()
        await audit('image-retention.image-removed', { imageId: candidate.id })
      }
      for (const candidate of plan.candidates.slice(policy.maxRemovals))
        result.skipped.push({ id: candidate.id, reason: 'batch-limit' })
      if (result.status === 'running') result.status = 'complete'
      return await finish()
    } catch (error) {
      if (error.code === 'E_IMAGE_OPERATIONS_BUSY') {
        result.status = 'held'
        result.holds = ['deployment-or-maintenance-in-progress']
        return await finish()
      }
      result.status = 'failed'
      result.error =
        sails.hooks?.secrets?.text?.(String(error.message).slice(-8192)) ||
        String(error.message).slice(-8192)
      // Earlier successful removals remain explicit even if a later audit/write fails.
      await finish().catch((saveError) =>
        sails.log.error(
          'Image retention could not persist its outcome:',
          saveError.message
        )
      )
      sails.log.error('Image retention stopped:', result.error)
      throw new Error(result.error, { cause: error })
    } finally {
      if (releaseImages) await releaseImages()
      await lock.close()
      // Never unlink another owner's lock. A crash leaves a conservative stale lock
      // for operator inspection rather than allowing overlapping cleanup workers.
      const contents = JSON.parse(await fs.readFile(lockPath, 'utf8'))
      if (contents.token === token) await fs.unlink(lockPath)
    }

    async function save() {
      await sails.helpers.setting.set(
        'imageRetentionLastRun',
        JSON.stringify(result)
      )
    }
    async function audit(action, details) {
      // audit.log deliberately tolerates errors. Destructive maintenance must not.
      await AuditLog.create({
        action,
        resourceType: 'image-retention',
        resourceId: token,
        details,
        user: null,
        team: null
      })
    }
    async function finish() {
      result.finishedAt = Date.now()
      await save()
      await audit('image-retention.finished', {
        status: result.status,
        mode: result.mode,
        removed: result.removed,
        skipped: result.skipped,
        failed: result.failed,
        holds: result.holds || result.plan?.holds || [],
        error: result.error || null
      })
      sails.log.info('Image retention:', {
        runId: token,
        status: result.status,
        mode: result.mode,
        candidates: result.plan?.candidates.length || 0,
        removed: result.removed.length,
        skipped: result.skipped.length,
        failed: result.failed.length
      })
      return result
    }
  }
}
