const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const command = promisify(execFile)
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/

module.exports = {
  friendlyName: 'Get image retention inventory',
  description:
    'Read a bounded, complete image and all-container Docker inventory.',
  inputs: { policy: { type: 'ref', required: true } },
  exits: { success: { outputType: 'ref' } },

  fn: async function ({ policy }) {
    const docker = sails.config.docker?.binaryPath || 'docker'
    const execute = async (args) =>
      (
        await command(docker, args, {
          timeout: 15000,
          maxBuffer: 8 * 1024 * 1024
        })
      ).stdout
    const imageIds = uniqueLines(
      await execute(['image', 'ls', '--all', '--no-trunc', '--quiet'])
    )
    const containerIds = uniqueLines(
      await execute(['container', 'ls', '--all', '--no-trunc', '--quiet'])
    )
    if (
      imageIds.length > policy.maxImages ||
      containerIds.length > policy.maxContainers
    )
      throw new Error(
        'Image retention Docker inventory exceeds its configured limit'
      )
    if (imageIds.some((id) => !IMAGE_ID.test(id)))
      throw new Error('Image retention received an incomplete image ID')
    const images = await inspect(imageIds, 'image', [
      '"id":{{json .Id}}',
      '"created":{{json .Created}}',
      '"size":{{json .Size}}',
      '"tags":{{json .RepoTags}}',
      '"digests":{{json .RepoDigests}}'
    ])
    const containers = await inspect(containerIds, 'container', [
      '"id":{{json .Id}}',
      '"imageId":{{json .Image}}'
    ])
    for (const image of images) {
      if (
        !IMAGE_ID.test(image.id) ||
        !Number.isFinite(Date.parse(image.created)) ||
        !Number.isSafeInteger(image.size) ||
        image.size < 0 ||
        !Array.isArray(image.tags) ||
        !Array.isArray(image.digests) ||
        [...image.tags, ...image.digests].some((ref) => typeof ref !== 'string')
      )
        throw new Error('Image retention received incomplete image metadata')
    }
    for (const container of containers) {
      if (
        !IMAGE_ID.test(container.imageId) ||
        !imageIds.includes(container.imageId)
      )
        throw new Error('Image retention could not resolve a container image')
    }
    // A disappearing container or image makes inspect fail; newly added containers
    // also invalidate this snapshot instead of being silently omitted.
    const after = uniqueLines(
      await execute(['container', 'ls', '--all', '--no-trunc', '--quiet'])
    )
    if (
      JSON.stringify(after.slice().sort()) !==
      JSON.stringify(containerIds.slice().sort())
    )
      throw new Error('Containers changed during image retention inventory')
    return { images, containers }

    async function inspect(ids, kind, fields) {
      const records = []
      for (let i = 0; i < ids.length; i += policy.inspectBatchSize) {
        const batch = ids.slice(i, i + policy.inspectBatchSize)
        const stdout = await execute([
          kind,
          'inspect',
          '--format',
          `{${fields.join(',')}}`,
          ...batch
        ])
        const parsed = stdout.trim()
          ? stdout
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line))
          : []
        if (
          parsed.length !== batch.length ||
          new Set(parsed.map((item) => item.id)).size !== batch.length ||
          parsed.some((item) => !batch.includes(item.id))
        )
          throw new Error('Image retention Docker inspection was incomplete')
        // Docker represents empty tags/digests as null on some engine versions.
        for (const item of parsed) {
          if (kind === 'image') {
            item.tags ??= []
            item.digests ??= []
          }
        }
        records.push(...parsed)
      }
      return records
    }
  }
}

function uniqueLines(value) {
  return [...new Set(String(value).trim().split(/\s+/).filter(Boolean))]
}
