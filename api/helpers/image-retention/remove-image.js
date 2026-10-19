const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const command = promisify(execFile)
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/
const TAG = /^slipway\/[a-z0-9][a-z0-9-]*:[1-9][0-9]*$/
const missing = (error) =>
  /No such image|No such object/i.test(String(error.stderr || ''))

module.exports = {
  friendlyName: 'Remove retained deployment image',
  description:
    'Remove freshly eligible aliases and the exact image without force or parent pruning.',
  inputs: {
    imageId: { type: 'string', required: true },
    tags: { type: 'ref', required: true },
    policy: { type: 'ref', required: true },
    deadline: { type: 'number', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ imageId, tags, policy, deadline }) {
    if (!(await sails.helpers.imageRetention.getPolicy()).remove)
      throw new Error('Image retention removal is disabled')
    if (!IMAGE_ID.test(imageId))
      throw new Error('Image retention requires a complete immutable image ID')
    if (
      !Array.isArray(tags) ||
      !tags.length ||
      tags.some((tag) => !TAG.test(tag)) ||
      new Set(tags).size !== tags.length ||
      !Number.isFinite(deadline)
    )
      throw new Error(
        'Image retention requires verified deployment tags and deadline'
      )
    const docker = sails.config.docker?.binaryPath || 'docker'
    const remaining = new Set(tags)
    const untagged = []
    const skip = (reason, extra = {}) => ({
      removed: false,
      reason,
      untagged,
      ...extra
    })
    const same = (a, b) =>
      JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    const execute = (args) =>
      command(docker, args, { timeout: 15000, maxBuffer: 1024 * 1024 })
    try {
      while (remaining.size) {
        if (Date.now() >= deadline)
          return skip('run-time-limit', { deferred: true })
        const current = await sails.helpers.imageRetention.getPolicy()
        if (JSON.stringify(current) !== JSON.stringify(policy))
          throw new Error('Image retention policy changed during the run')
        const inventory = await sails.helpers.imageRetention.getInventory.with({
          policy
        })
        const image = inventory.images.find((item) => item.id === imageId)
        if (!image) return skip('image-disappeared')
        const plan = await sails.helpers.imageRetention.getPlan.with({
          inventory,
          policy
        })
        if (plan.status === 'held')
          return skip('inventory-held', {
            held: true,
            holds: plan.holds,
            deferred: true
          })
        if (!plan.candidates.some((item) => item.id === imageId))
          return skip('protection-or-inventory-changed')
        if (!same(image.tags, remaining) || image.digests.length)
          return skip('image-tags-changed', { deferred: true })
        const tag = [...remaining][0]
        // The shared guard excludes Slipway writers for this entire sequence.
        // External Docker operators must likewise avoid concurrent retagging.
        let stdout
        try {
          ;({ stdout } = await execute([
            'image',
            'inspect',
            '--format',
            '{"id":{{json .Id}},"tags":{{json .RepoTags}},"digests":{{json .RepoDigests}}}',
            imageId,
            tag
          ]))
        } catch (error) {
          if (!missing(error)) throw error
          await sails.helpers.imageRetention.getInventory.with({ policy })
          return skip('image-tags-changed', { deferred: true })
        }
        const records = stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        if (
          records.length !== 2 ||
          records.some(
            (item) =>
              !IMAGE_ID.test(item.id) ||
              !Array.isArray(item.tags) ||
              item.tags.some((tag) => typeof tag !== 'string') ||
              (item.digests !== null && !Array.isArray(item.digests))
          )
        )
          throw new Error('Image retention tag inspection was incomplete')
        if (
          records.some(
            (item) =>
              item.id !== imageId ||
              !same(item.tags, remaining) ||
              item.digests?.length
          )
        )
          return skip('image-tags-changed', { deferred: true })
        let conflict = false
        try {
          // Multi-repository IDs conflict without force. Detach one verified
          // alias, then use the immutable ID when exactly one tag remains.
          await execute([
            'image',
            'rm',
            '--no-prune',
            remaining.size === 1 ? imageId : tag
          ])
          untagged.push(tag)
          remaining.delete(tag)
        } catch (error) {
          const diagnostic = String(error.stderr || '')
          if (
            missing(error) ||
            (/\bconflict\b/i.test(diagnostic) &&
              /multiple repositories|used by.*container|dependent child|image is referenced/i.test(
                diagnostic
              ))
          )
            conflict = true
          else throw error
        }
        // Untagging is not image deletion. Confirm absence before counting a
        // removed ID; any incomplete/failed inventory stops the entire run.
        const after = await sails.helpers.imageRetention.getInventory.with({
          policy
        })
        const exists = after.images.some((item) => item.id === imageId)
        if (conflict)
          return skip(exists ? 'docker-conflict' : 'image-disappeared', {
            deferred: exists
          })
        if (!exists) return { removed: true, untagged }
        if (!remaining.size)
          return skip('image-still-referenced', { deferred: true })
      }
      return skip('image-still-referenced', { deferred: true })
    } catch (error) {
      error.untagged = untagged
      throw error
    }
  }
}
