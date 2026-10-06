// Not shipped in the host bundle. Only the loopback image policy and forced
// failed-health response differ; production host/program/engine are reused.
const fs = require('node:fs')
const path = require('node:path')
let started = false,
  nextId = 0
const pending = new Map()
function audit(event) {
  const id = ++nextId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    process.send({ type: 'request', id, method: 'audit', args: [event] })
  })
}
process.on('message', async (message) => {
  if (message?.type === 'reply') {
    const callback = pending.get(message.id)
    pending.delete(message.id)
    callback?.(message.value)
    return
  }
  if (started) return process.exit(1)
  started = true
  const { bundleDirectory, failHealth, ...input } = message.input
  const lib = path.join(bundleDirectory, 'api/lib')
  const manifest = require(path.join(bundleDirectory, 'host-manifest.json'))
  require(path.join(lib, 'upgrade-process')).observeSpawns((identity) =>
    audit({ event: 'worker', identity })
  )
  let value
  try {
    value = await require(path.join(lib, 'upgrade-host-program')).run(input, {
      native: true,
      nativeRevision: manifest.sourceRevision,
      imageAllowed: (image) =>
        /^localhost:\d+\/slipway-full-fixture@sha256:[a-f0-9]{64}$/.test(
          image || ''
        ),
      timeoutMs: message.timeoutMs - 10000,
      reserveBytes: 128 * 1024 * 1024,
      onCheckpoint: (checkpoint) => audit({ event: 'checkpoint', checkpoint }),
      ...(failHealth ? { healthOverride: async () => ({ ready: false }) } : {})
    })
  } catch (error) {
    value = {
      success: false,
      code: error.code || 'upgradeHostRecoveryRequired'
    }
  }
  if (!value.success && value.filename) {
    const host = require(path.join(lib, 'upgrade-host-controller'))
    const saved = host.read(value.filename)
    // Read-only SQLite connections may still alter WAL shared-memory files.
    // Diagnostics must never open the byte-bound stopped source.
    const storage = require(path.join(lib, 'upgrade-storage-stage'))
    const options = { maxBytes: saved.maxBytes, timeoutMs: 5000 }
    const before = storage.inspectStorage({
      ...options,
      directory: saved.reviewed.sourceDirectory
    })
    const copy = storage.stageStorage({
      ...options,
      source: saved.reviewed.sourceDirectory,
      directory: input.directory
    })
    try {
      value.catalog =
        await require('./upgrade-catalog-diagnostics.cjs').bounded({
          services: host.services(
            copy.dataDirectory,
            saved.reviewed.instanceId
          ),
          steps: saved.reviewed.identity.manifest.steps
        })
      const after = storage.inspectStorage({
        ...options,
        directory: saved.reviewed.sourceDirectory
      })
      if (before.hash !== after.hash)
        throw new Error('Diagnostic source changed')
    } finally {
      fs.rmSync(copy.directory, { recursive: true, force: true })
    }
    value.storageStaged = Boolean(saved.stage)
    value.backupsVerified = Boolean(saved.backupSet)
    value.receiptsPrepared = Boolean(saved.handle)
  }
  process.send({ type: 'result', value }, () => process.exit(0))
})
