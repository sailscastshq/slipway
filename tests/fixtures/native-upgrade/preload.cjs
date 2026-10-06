// Explicit test entrypoint only; no production flags or admission bypass.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const version = require('../../../package.json').version
const runner = path.basename(process.argv[1] || '')
const coordinator =
  process.execArgv.includes('--test') && !process.env.NODE_TEST_CONTEXT
if (
  require('semver').gte(version, '0.0.88') &&
  runner !== 'sounding.js' &&
  !coordinator &&
  !process.env.SLIPWAY_TEST_NATIVE_CONFIG
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-native-test-'))
  fs.chmodSync(root, 0o700)
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'initialize.cjs'), root],
    { env, encoding: 'utf8', timeout: 90000, maxBuffer: 65536 }
  )
  if (result.status !== 0) {
    fs.rmSync(root, { recursive: true, force: true })
    throw new Error('Native fixture initialization failed: ' + result.stderr)
  }
  const filename = result.stdout
  const descriptor = JSON.parse(fs.readFileSync(filename))
  Object.assign(process.env, descriptor.env, {
    SLIPWAY_TEST_NATIVE_CONFIG: filename
  })
  process.once('exit', () => fs.rmSync(root, { recursive: true, force: true }))
}
