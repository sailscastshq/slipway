const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

module.exports = {
  friendlyName: 'Clean up deployment images',
  description:
    'Remove eligible old deployment images or explicitly preview under one shared instance lock.',
  inputs: { preview: { type: 'boolean', defaultsTo: false } },
  exits: { success: { outputType: 'ref' } },

  fn: async function ({ preview = false } = {}) {
    const policy = await sails.helpers.imageRetention.getPolicy()
    const mode = policy.remove && !preview ? 'remove' : 'dry-run'
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
      sails.log.info(
        `Clean up deployment images: busy (${mode}); image-retention-lock-present. Inspect the recorded owner before retrying.`
      )
      return {
        status: 'busy',
        removed: [],
        skipped: [],
        reason:
          'The image retention lock is present; inspect its recorded owner.',
        summary: {
          status: 'busy',
          mode,
          holds: ['image-retention-lock-present'],
          inventoryStatus: 'not-started',
          candidates: 0,
          removed: 0,
          untagged: 0,
          skipped: 0,
          errors: 0,
          deferred: 0
        }
      }
    }
    const result = {
      runId: token,
      startedAt: Date.now(),
      status: 'planning',
      mode,
      policy,
      removed: [],
      untagged: [],
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
      if (plan.status === 'held' || result.mode === 'dry-run')
        return await finish()

      result.status = 'running'
      for (const candidate of plan.candidates) {
        if (result.removed.length >= policy.maxRemovals) {
          result.stopReason = 'batch-limit'
          break
        }
        if (Date.now() - result.startedAt >= policy.maxRunMs) {
          result.stopReason = 'run-time-limit'
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
        const freshCandidate = freshPlan.candidates.find(
          (image) => image.id === candidate.id
        )
        if (!freshCandidate) {
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
          const outcome = await sails.helpers.imageRetention.removeImage.with({
            imageId: candidate.id,
            tags: freshCandidate.tags,
            policy,
            deadline: result.startedAt + policy.maxRunMs
          })
          if (
            !outcome ||
            typeof outcome.removed !== 'boolean' ||
            !Array.isArray(outcome.untagged)
          )
            throw new Error(
              'Image retention removal returned no confirmed outcome'
            )
          result.untagged.push(
            ...outcome.untagged.map((tag) => ({ imageId: candidate.id, tag }))
          )
          if (!outcome.removed) {
            result.skipped.push({
              id: candidate.id,
              reason: outcome.reason,
              deferred: Boolean(outcome.deferred)
            })
            if (outcome.held) {
              result.status = 'held'
              result.holds = outcome.holds
              break
            }
            continue
          }
        } catch (error) {
          if (Array.isArray(error.untagged))
            result.untagged.push(
              ...error.untagged.map((tag) => ({ imageId: candidate.id, tag }))
            )
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
      if (result.status === 'running') result.status = 'complete'
      return await finish()
    } catch (error) {
      if (error.code === 'E_IMAGE_OPERATIONS_BUSY') {
        result.status = 'held'
        result.holds = [error.reason || 'deployment-or-maintenance-in-progress']
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
      sails.log.error('Deployment image cleanup stopped:', result.error)
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
      if (result.mode === 'remove') {
        const accounted = new Set([
          ...result.removed,
          ...result.skipped.map((item) => item.id),
          ...result.failed.map((item) => item.id)
        ])
        for (const candidate of result.plan?.candidates || []) {
          if (!accounted.has(candidate.id))
            result.skipped.push({
              id: candidate.id,
              reason:
                result.stopReason ||
                (result.status === 'held' ? 'inventory-held' : 'run-stopped')
            })
        }
      }
      result.finishedAt = Date.now()
      const holds = (result.holds || result.plan?.holds || [])
        .slice(0, 8)
        .map((reason) => {
          const value = String(reason)
          return (sails.hooks?.secrets?.text?.(value) || value).slice(0, 256)
        })
      result.summary = {
        status: result.status,
        mode: result.mode,
        holds,
        inventoryStatus: result.plan?.status || 'not-started',
        skippedReasons: reasonCounts(
          result.skipped.map((item) => [item.reason])
        ),
        protectedReasons: reasonCounts(
          (result.plan?.protected || []).map((item) => item.reasons)
        ),
        candidates: result.plan?.candidates.length || 0,
        removed: result.removed.length,
        untagged: result.untagged.length,
        skipped: result.skipped.length,
        errors: Math.max(result.failed.length, result.error ? 1 : 0),
        deferred: result.skipped.filter(
          (item) =>
            item.deferred ||
            [
              'batch-limit',
              'run-time-limit',
              'run-stopped',
              'inventory-held'
            ].includes(item.reason)
        ).length
      }
      await save()
      await audit('image-retention.finished', {
        status: result.status,
        mode: result.mode,
        removed: result.removed,
        untagged: result.untagged,
        skipped: result.skipped,
        failed: result.failed,
        holds: result.holds || result.plan?.holds || [],
        error: result.error || null
      })
      const summary = result.summary
      sails.log.info(
        `Clean up deployment images: ${summary.status} (${
          summary.mode
        }); inventory ${summary.inventoryStatus}; candidates ${
          summary.candidates
        }, removed ${summary.removed}, skipped ${summary.skipped}, errors ${
          summary.errors
        }, deferred ${summary.deferred}, untagged ${summary.untagged}.${
          holds.length ? ` Hold: ${holds.join('; ')}. No hold was cleared.` : ''
        }`
      )
      return result
    }
  }
}

function reasonCounts(groups) {
  const counts = new Map()
  for (const reasons of groups)
    for (const value of reasons || []) {
      const key = /^[a-z][a-z-]{0,63}$/.test(value || '') ? value : 'other'
      const boundedKey = counts.has(key) || counts.size < 16 ? key : 'other'
      counts.set(boundedKey, (counts.get(boundedKey) || 0) + 1)
    }
  return Object.fromEntries(counts)
}
