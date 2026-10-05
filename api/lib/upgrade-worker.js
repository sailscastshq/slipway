// No Sails lift, environment configuration, ORM or application jobs here.
const registry = require('./upgrade-registry')
const codes = require('./upgrade-error-codes')
const coordinator = require('./upgrade-coordinator')
const preflight = require('./upgrade-preflight')
const backups = require('./upgrade-backups')
let nextId = 0
let started = false
const pending = new Map()
function request(method, ...args) {
  const id = ++nextId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    process.send({ type: 'request', id, method, args })
  })
}
process.on('message', async (message) => {
  if (message?.type === 'reply') {
    const resolve = pending.get(message.id)
    if (!resolve) return process.exit(1)
    pending.delete(message.id)
    resolve(message.value)
    return
  }
  if (started) return process.exit(1)
  started = true
  const { operation, input, timeoutMs } = message
  // The public operation and trusted adapters always override input fields.
  const options = {
    ...input,
    timeoutMs,
    preparePlan: registry.preparePlan,
    verifyFence: (...args) => request('fence', ...args),
    audit: (...args) => request('audit', ...args)
  }
  try {
    let value
    switch (operation) {
      case 'plan':
        value = registry.createReleasePlan(options)
        break
      case 'backup':
        value = await backups.createBackupSet(options)
        break
      case 'preflight':
        value = await preflight(options)
        break
      case 'prepare':
        value = await coordinator.prepareRun(options)
        break
      case 'run':
        value = await coordinator.run(options)
        break
      case 'stageStorage':
        value = require('./upgrade-storage-stage').stageStorage(options)
        break
      case 'verifySource':
        value = require('./upgrade-storage-stage').verifySource(options)
        break
      case 'observeWriters':
        value = await require('./upgrade-writer-observer').observeWriters(
          options
        )
        break
      case 'status':
        value = coordinator.status(options.filename)
        break
      default:
        throw new Error('Unsupported worker operation')
    }
    process.send({ type: 'result', value }, () => process.exit(0))
  } catch (error) {
    // Exception text may contain SQL, paths or application data. The caller
    // inspects the durable ledger/journal instead of receiving raw messages.
    const code = codes.has(error.code) ? error.code : 'upgradeWorkerFailed'
    process.send({ type: 'failure', code }, () => process.exit(1))
  }
})
