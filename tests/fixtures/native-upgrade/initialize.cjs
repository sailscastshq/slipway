// Test-only fresh private storage. Uses the production registry, mandatory
// backups, clone preflight and transaction/receipt engine; never writes receipts
// or native catalogs itself. No application/ORM/worker is admitted until done.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { runBounded } = require('../../../api/lib/upgrade-process')
const host = require('../../../api/lib/upgrade-host-controller')
const startup = require('../../../api/lib/upgrade-startup')
async function initialize(directory) {
  const root = fs.realpathSync(directory)
  const stat = fs.lstatSync(root)
  if (
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o700 ||
    fs.readdirSync(root).length
  )
    throw new Error('Fresh private fixture storage required')
  const lock = path.join(root, 'owner.lock')
  const token = crypto.randomUUID()
  fs.writeFileSync(lock, token, { mode: 0o600, flag: 'wx' })
  const data = path.join(root, 'data')
  fs.mkdirSync(data, { mode: 0o700 })
  require('../../../api/lib/upgrade-fresh-storage')(data)
  const instanceId = 'native-test:' + crypto.randomUUID()
  const image =
    'ghcr.io/sailscastshq/slipway@sha256:' +
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.resolve(__dirname, '../../../package.json')))
      .digest('hex')
  const services = host.services(data, instanceId)
  const identities = services.map((service) => ({
    ...service,
    ...fs.statSync(service.path)
  }))
  const owner = 'fresh-fixture:' + process.pid + ':' + token
  // The only admitted consumer during preparation is the fixed supervised
  // migration child. These newly created, private files have never been shared
  // with an app; the fixture owner retains the exclusive preparation lock.
  const fence = async (targets) => {
    if (fs.readFileSync(lock, 'utf8') !== token)
      throw new Error('Fixture owner lost')
    for (const target of targets) {
      const expected = identities.find(
        (item) => item.databaseKey === target.databaseKey
      )
      const actual = fs.lstatSync(target.path)
      if (
        !expected ||
        fs.realpathSync(target.path) !== expected.path ||
        actual.dev !== expected.dev ||
        actual.ino !== expected.ino ||
        actual.uid !== process.getuid() ||
        actual.mode & 0o077
      )
        throw new Error('Fixture target changed')
    }
    return {
      id: token,
      writersStopped: true,
      exclusiveController: true,
      controllerOwner: owner,
      databaseKeys: targets.map((target) => target.databaseKey)
    }
  }
  const bounded = (operation, input, extra = {}) =>
    runBounded({ operation, input, timeoutMs: 60000, ...extra })
  try {
    const identity = await bounded('plan', {
      services,
      instanceId,
      image,
      mode: 'fresh'
    })
    const backupSet = await bounded(
      'backup',
      {
        databases: services,
        directory: root,
        maxBytes: 64 * 1024 * 1024,
        reserveBytes: 0
      },
      { verifyFence: fence }
    )
    const preflight = await bounded('preflight', { identity, backupSet })
    const handle = await bounded('prepare', {
      directory: root,
      identity,
      databases: services,
      backupSet,
      preflight,
      instanceId
    })
    const result = await bounded(
      'run',
      {
        filename: handle.filename,
        owner,
        expectedInstanceId: instanceId,
        expectedManifestHash: identity.hash
      },
      { verifyFence: fence, audit: async () => true }
    )
    if (
      result.phase !== 'completed' ||
      !result.reconciled ||
      result.pending.length
    )
      throw new Error('Fixture not initialized')
    const markerFile = path.join(root, 'launch.json')
    startup.writeMarker(markerFile, {
      format: 1,
      phase: 'ready',
      filename: handle.filename,
      instanceId,
      version: require('../../../package.json').version,
      image,
      manifestHash: identity.hash
    })
    const datastores = Object.fromEntries(
      services.map((service) => [
        service.datastore,
        { adapter: 'sails-sqlite', url: service.path }
      ])
    )
    startup.verify({
      markerFile,
      version: require('../../../package.json').version,
      image,
      instanceId,
      manifestHash: identity.hash,
      datastores
    })
    const descriptor = {
      datastores,
      models: { migrate: 'safe' },
      env: {
        SLIPWAY_UPGRADE_MARKER: markerFile,
        SLIPWAY_UPGRADE_IMAGE: image,
        SLIPWAY_UPGRADE_INSTANCE: instanceId,
        SLIPWAY_UPGRADE_MANIFEST: identity.hash
      }
    }
    const filename = path.join(root, 'fixture.json')
    fs.writeFileSync(filename, JSON.stringify(descriptor), {
      mode: 0o600,
      flag: 'wx'
    })
    return filename
  } finally {
    fs.unlinkSync(lock)
  }
}
if (require.main === module)
  initialize(process.argv[2])
    .then((filename) => process.stdout.write(filename))
    .catch((error) => {
      process.stderr.write(error.code || 'nativeFixtureInitializationFailed')
      process.exitCode = 1
    })
module.exports = initialize
