const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const command = promisify(execFile)
const { IMAGE_ID } = require('../../lib/deployment-recovery')
module.exports = {
  friendlyName: 'Inspect deployment image',
  description:
    'Inspect a local deployment artifact without pulling or rebuilding it.',
  inputs: { imageReference: { type: 'string', required: true } },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ imageReference }) {
    if (
      !IMAGE_ID.test(imageReference) &&
      !/^slipway\/[a-z0-9][a-z0-9-]*:[1-9][0-9]*$/.test(imageReference)
    )
      throw new Error(
        'A complete local image ID or known deployment tag is required.'
      )
    const binary = sails.config.docker?.binaryPath || 'docker'
    const options = { timeout: 15000, maxBuffer: 1024 * 1024 }
    // Read Docker's native single-image JSON. Optional Config.Labels is absent
    // on valid unlabelled images; Go template field traversal rejects that map.
    // Keep raw configuration in memory only and never include it in errors/logs.
    const { stdout } = await command(
      binary,
      ['image', 'inspect', imageReference],
      options
    )
    let inspected
    try {
      inspected = JSON.parse(stdout)
    } catch {
      throw new Error('The local deployment image metadata is invalid.')
    }
    if (
      !Array.isArray(inspected) ||
      inspected.length !== 1 ||
      !inspected[0] ||
      typeof inspected[0] !== 'object' ||
      Array.isArray(inspected[0])
    )
      throw new Error('Exactly one local deployment image is required.')
    const record = inspected[0]
    if (
      !record.Config ||
      typeof record.Config !== 'object' ||
      Array.isArray(record.Config) ||
      (record.Config.Labels != null &&
        (typeof record.Config.Labels !== 'object' ||
          Array.isArray(record.Config.Labels) ||
          Object.values(record.Config.Labels).some(
            (value) => typeof value !== 'string'
          )))
    )
      throw new Error('The local deployment image configuration is invalid.')
    const image = {
      id: record.Id,
      os: record.Os,
      architecture: record.Architecture,
      labels: record.Config.Labels
    }
    if (
      !IMAGE_ID.test(image.id) ||
      (IMAGE_ID.test(imageReference) && image.id !== imageReference)
    )
      throw new Error(
        'The local deployment image identity could not be verified.'
      )
    const compatibility =
      image.labels?.['io.slipway.rollback.compatibility'] ?? null
    if (
      compatibility !== null &&
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(compatibility)
    )
      throw new Error(
        'The image rollback compatibility declaration is invalid.'
      )
    const { stdout: platform } = await command(
      binary,
      [
        'info',
        '--format',
        '{"os":{{json .OSType}},"architecture":{{json .Architecture}}}'
      ],
      options
    )
    const host = JSON.parse(platform.trim())
    const normalize = (arch) =>
      ({ x86_64: 'amd64', aarch64: 'arm64' }[arch] || arch)
    if (
      typeof image.architecture !== 'string' ||
      !image.architecture ||
      typeof host.architecture !== 'string' ||
      !host.architecture ||
      image.os !== 'linux' ||
      image.os !== host.os ||
      normalize(image.architecture) !== normalize(host.architecture)
    )
      throw new Error(
        'The local deployment image does not match the Docker host platform.'
      )
    return {
      imageId: image.id,
      compatibility,
      os: image.os,
      architecture: image.architecture
    }
  }
}
