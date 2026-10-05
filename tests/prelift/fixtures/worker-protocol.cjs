const fs = require('node:fs')
process.once('message', ({ input }) => {
  fs.writeFileSync(input.started, String(process.pid))
  if (input.mode === 'output') {
    process.stdout.write('fixture-secret'.repeat(10000))
    setInterval(() => {}, 100)
  } else if (input.mode === 'callback') {
    setInterval(() => {}, 100)
    process.send({ type: 'request', id: 1, method: 'fence', args: [] })
  } else {
    process.send({ type: 'result', value: Object.keys(process.env) }, () =>
      process.exit(0)
    )
  }
})
