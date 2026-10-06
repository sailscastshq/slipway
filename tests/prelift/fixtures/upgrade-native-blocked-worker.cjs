const path = require('node:path')
let id = 0
const pending = new Map()
process.on('message', async (message) => {
  if (message.type === 'reply') {
    pending.get(message.id)?.()
    pending.delete(message.id)
    return
  }
  const input = message.input
  const supervisor = require(path.join(
    input.bundleDirectory,
    'api/lib/upgrade-process'
  ))
  supervisor.observeSpawns(
    (identity) =>
      new Promise((resolve) => {
        const next = ++id
        pending.set(next, resolve)
        process.send({
          type: 'request',
          id: next,
          method: 'audit',
          args: [{ event: 'worker', identity }]
        })
      })
  )
  await supervisor.createSupervisor(input.blockedWorker)({
    operation: 'fixture',
    input,
    timeoutMs: 30000
  })
})
