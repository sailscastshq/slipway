// Propagate the explicit preload to Sounding's Node test children. Each trial
// process initializes its own private native databases before Sails imports.
const path = require('node:path')
const { spawn } = require('node:child_process')
const executable = path.join(
  path.dirname(require.resolve('sounding/package.json')),
  'bin/sounding.js'
)
const preload = path.join(__dirname, 'native-upgrade/preload.cjs')
const child = spawn(process.execPath, [executable, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: (
      (process.env.NODE_OPTIONS || '') +
      ' --require ' +
      JSON.stringify(preload)
    ).trim()
  }
})
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => child.kill(signal))
child.once('error', () => {
  process.exitCode = 1
})
child.once('close', (code, signal) => {
  process.exitCode = signal ? 1 : code
})
