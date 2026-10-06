// Read-only first slice. No helper creation, root service or host execution.
const fs = require('node:fs')
const path = require('node:path')
const host = require('./upgrade-host-controller')
function fail() {
  throw Object.assign(new Error('Native host review is required.'), {
    code: 'upgradeHostRequired'
  })
}
const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'"
function command(operation, image, extra = []) {
  if (
    !/^ghcr\.io\/sailscastshq\/slipway@sha256:[a-f0-9]{64}$/.test(image || '')
  )
    fail()
  const directory =
    process.env.SLIPWAY_UPGRADE_STATE_ROOT || '/var/lib/slipway/upgrades'
  const container = process.env.SLIPWAY_UPGRADE_CONTAINER || 'slipway'
  return [
    'sudo bash scripts/upgrade-host-native.sh',
    operation,
    '--bundle',
    quote('<verified-host-bundle.tar.gz>'),
    '--bundle-sha256',
    quote('<verified-archive-sha256>'),
    '--image',
    quote(image),
    '--state-dir',
    quote(directory),
    '--container',
    quote(container),
    ...extra.flatMap(([key, value]) => [key, quote(value)])
  ].join(' ')
}
function status(id) {
  const filename = process.env.SLIPWAY_UPGRADE_HOST_CHECKPOINT
  if (!filename) return null
  const root = fs.realpathSync(process.env.SLIPWAY_UPGRADE_STATE_ROOT)
  if (!fs.realpathSync(filename).startsWith(root + path.sep)) fail()
  const result = host.status(filename)
  if (
    result.instanceId !== process.env.SLIPWAY_UPGRADE_INSTANCE ||
    (id && id !== result.id)
  )
    fail()
  return {
    ...result,
    execution: 'host-native',
    hostCommand: command(
      result.recoveryRequired ? 'resume' : 'status',
      result.image,
      [
        ['--checkpoint', filename],
        ['--instance', result.instanceId],
        ['--approve-plan', result.reviewHash]
      ]
    )
  }
}
function review(image) {
  return {
    execution: 'host-native',
    image,
    requiresVerifiedBundle: true,
    hostCommand: command('plan', image),
    message:
      'Review the native plan on the host, then apply its exact instance and approval hash. Automatic UI execution is not enabled.'
  }
}
module.exports = { review, status, command }
