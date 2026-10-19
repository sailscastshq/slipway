const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const command = promisify(execFile)

module.exports = {
  friendlyName: 'Remove retained deployment image',
  description:
    'Remove one verified immutable image ID without force or parent pruning.',
  inputs: { imageId: { type: 'string', required: true } },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ imageId }) {
    if (!(await sails.helpers.imageRetention.getPolicy()).remove)
      throw new Error('Image retention removal is disabled')
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId))
      throw new Error('Image retention requires a complete immutable image ID')
    await command(
      sails.config.docker?.binaryPath || 'docker',
      ['image', 'rm', '--no-prune', imageId],
      { timeout: 15000, maxBuffer: 1024 * 1024 }
    )
    return { removed: true }
  }
}
