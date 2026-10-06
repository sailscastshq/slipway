// Fixed native host controller worker. Input is private IPC, never argv.
const supervisor = require('./upgrade-process')
const program = require('./upgrade-host-program')
const manifest = require('../../host-manifest.json')
let nextId = 0
const pending = new Map()
function audit(event) {
  const id = ++nextId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    process.send({ type: 'request', id, method: 'audit', args: [event] })
  })
}
let started = false
process.on('message', async (message) => {
  if (message?.type === 'reply') {
    const callback = pending.get(message.id)
    if (!callback) return process.exit(1)
    pending.delete(message.id)
    callback(message.value)
    return
  }
  if (started || message?.operation !== 'host') return process.exit(1)
  started = true
  supervisor.observeSpawns((identity) => audit({ event: 'worker', identity }))
  try {
    const value = await program.run(message.input, {
      native: true,
      nativeRevision: manifest.sourceRevision,
      timeoutMs: Math.max(1, message.timeoutMs - 30000),
      onCheckpoint: (checkpoint) => audit({ event: 'checkpoint', checkpoint })
    })
    process.send({ type: 'result', value }, () => process.exit(0))
  } catch (error) {
    process.send(
      {
        type: 'result',
        value: {
          success: false,
          code: /^upgrade[A-Za-z]+$/.test(error.code || '')
            ? error.code
            : 'upgradeHostRecoveryRequired',
          recoveryRequired: true
        }
      },
      () => process.exit(0)
    )
  }
})
