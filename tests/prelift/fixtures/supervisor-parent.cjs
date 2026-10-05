const path = require('node:path')
const { createSupervisor } = require('../../../api/lib/upgrade-process')
process.once('message', (input) => {
  createSupervisor(path.join(__dirname, 'blocked-upgrade-worker.cjs'))({
    operation: 'fixture',
    input,
    timeoutMs: 20000
  }).catch(() => process.exit(1))
})
