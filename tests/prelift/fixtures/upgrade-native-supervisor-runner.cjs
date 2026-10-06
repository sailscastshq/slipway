// Disposable lifecycle fixture; never packaged or accepted as a production worker.
const fs = require('node:fs')
const path = require('node:path')
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
require(path.join(input.bundleDirectory, 'scripts/upgrade-host-native.cjs'))
  .supervise(input, {
    worker: path.resolve(__dirname, 'upgrade-native-blocked-worker.cjs'),
    timeoutMs: 30000
  })
  .then((value) => {
    process.stdout.write(JSON.stringify(value))
    process.exitCode = value.success ? 0 : 1
  })
