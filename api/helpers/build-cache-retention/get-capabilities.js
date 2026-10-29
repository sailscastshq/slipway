const { execFile } = require('node:child_process')
const command = require('node:util').promisify(execFile)
const { parse } = require('../../lib/cache-prune-capabilities')

module.exports = {
  friendlyName: 'Read bounded cache cleanup capabilities',
  description: 'Inspect help only; never execute cleanup or switch builders.',
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    const { stdout } = await command(
      sails.config.docker?.binaryPath || 'docker',
      ['builder', 'prune', '--help'],
      { timeout: 15000, maxBuffer: 65536 }
    )
    return parse(stdout)
  }
}
