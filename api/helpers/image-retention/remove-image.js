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
    'Defer multi-tag images and remove eligible immutable IDs without force or parent pruning.',
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
      tags.some((tag) => typeof tag !== 'string' || !TAG.test(tag)) ||
      new Set(tags).size !== tags.length ||
      !Number.isFinite(deadline)
    )
      throw new Error(
        'Image retention requires verified deployment tags and deadline'
      )
    const skip = (reason, extra = {}) => ({
      removed: false,
      untagged: [],
      reason,
      ...extra
    })
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
    // Docker does not offer compare-and-delete for mutable tags. Never untag:
    // a retarget between inspect and rm TAG could delete an unrelated image.
    if (image.tags.length > 1)
      return skip('multiple-image-tags', { deferred: true })
    const sameTags = (value) =>
      JSON.stringify([...value].sort()) === JSON.stringify([...tags].sort())
    if (!sameTags(image.tags) || image.digests.length)
      return skip('image-tags-changed', { deferred: true })
    const docker = sails.config.docker?.binaryPath || 'docker'
    const execute = (args) =>
      command(docker, args, { timeout: 15000, maxBuffer: 1024 * 1024 })
    let stdout
    try {
      ;({ stdout } = await execute([
        'image',
        'inspect',
        '--format',
        '{"id":{{json .Id}},"tags":{{json .RepoTags}},"digests":{{json .RepoDigests}}}',
        imageId
      ]))
    } catch (error) {
      if (!missing(error)) throw error
      await sails.helpers.imageRetention.getInventory.with({ policy })
      return skip('image-disappeared')
    }
    const records = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    if (
      records.length !== 1 ||
      records.some(
        (item) =>
          !IMAGE_ID.test(item.id) ||
          (item.tags !== null &&
            (!Array.isArray(item.tags) ||
              item.tags.some((tag) => typeof tag !== 'string'))) ||
          (item.digests !== null && !Array.isArray(item.digests))
      )
    )
      throw new Error('Image retention inspection was incomplete')
    const inspected = records[0]
    if (
      inspected.id !== imageId ||
      !sameTags(inspected.tags || []) ||
      inspected.digests?.length
    )
      return skip('image-tags-changed', { deferred: true })
    if (Date.now() >= deadline)
      return skip('run-time-limit', { deferred: true })
    let conflict = false
    try {
      // Always address the original immutable ID. A racing extra tag must be
      // handled by Docker's non-force conflict, never by removing a mutable tag.
      await execute(['image', 'rm', '--no-prune', imageId])
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
    const after = await sails.helpers.imageRetention.getInventory.with({
      policy
    })
    const exists = after.images.some((item) => item.id === imageId)
    if (conflict)
      return skip(exists ? 'docker-conflict' : 'image-disappeared', {
        deferred: exists
      })
    if (!exists) return { removed: true, untagged: [] }
    return skip('image-still-referenced', { deferred: true })
  }
}
