const fs = require('node:fs')
const ledger = require('./upgrade-ledger')
const assertReady = require('./upgrade-entry-guard')
function fail() {
  throw Object.assign(
    new Error(
      'Start through the host upgrade checkpoint before launching Slipway.'
    ),
    { code: 'upgradeNotReady' }
  )
}
function readMarker(filename) {
  const stat = fs.lstatSync(filename)
  if (
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.uid !== process.getuid() ||
    stat.size > 1024 * 1024
  )
    fail()
  const envelope = JSON.parse(fs.readFileSync(filename, 'utf8'))
  if (
    envelope.marker?.format !== 1 ||
    envelope.hash !== ledger.digest(envelope.marker)
  )
    fail()
  return envelope.marker
}
function verify({
  markerFile,
  version,
  image,
  instanceId,
  manifestHash,
  datastores
}) {
  try {
    const marker = readMarker(markerFile)
    if (
      !['publishing', 'ready'].includes(marker.phase) ||
      marker.version !== version ||
      marker.image !== image ||
      marker.instanceId !== instanceId ||
      marker.manifestHash !== manifestHash
    )
      fail()
    const ready = assertReady({
      filename: marker.filename,
      instanceId,
      version,
      image,
      manifestHash
    })
    if (datastores) {
      const state = require('./upgrade-coordinator').readJournal(
        marker.filename
      )
      for (const target of state.targets) {
        const service = datastores[target.datastore]
        if (
          !service ||
          service.adapter !== 'sails-sqlite' ||
          service.url === ':memory:'
        )
          fail()
        const stat = fs.statSync(require('node:path').resolve(service.url))
        if (stat.dev !== target.device || stat.ino !== target.inode) fail()
      }
    }
    return { ...ready, instanceId }
  } catch {
    fail()
  }
}
function fromEnvironment(datastores) {
  const version = require('../../package.json').version
  const markerFile = process.env.SLIPWAY_UPGRADE_MARKER
  // The release remains 0.0.87 until its coordinated release gate. Existing
  // unannotated 86/87 boot is unchanged; annotated candidate boot always checks.
  if (!markerFile && /^0\.0\.(?:[0-9]|[1-7][0-9]|8[0-7])$/.test(version))
    return null
  return verify({
    markerFile,
    version,
    image: process.env.SLIPWAY_UPGRADE_IMAGE,
    instanceId: process.env.SLIPWAY_UPGRADE_INSTANCE,
    manifestHash: process.env.SLIPWAY_UPGRADE_MANIFEST,
    datastores
  })
}
function writeMarker(filename, marker) {
  const temporary =
    filename + '.' + require('node:crypto').randomUUID() + '.tmp'
  fs.writeFileSync(
    temporary,
    JSON.stringify({ marker, hash: ledger.digest(marker) }),
    { mode: 0o600, flag: 'wx' }
  )
  const fd = fs.openSync(temporary, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(temporary, filename)
  const folder = fs.openSync(require('node:path').dirname(filename), 'r')
  try {
    fs.fsyncSync(folder)
  } finally {
    fs.closeSync(folder)
  }
}
module.exports = { verify, fromEnvironment, writeMarker, readMarker }
