const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-quest-container-'))

try {
  // An allowlist excludes checkout metadata, local config, credentials, assets,
  // receipts, and application data. CI dependencies come from a clean npm ci.
  for (const file of [
    'package.json',
    'package-lock.json',
    'config/quest.js',
    'config/env/console.js',
    'config/env/production.js',
    'scripts/check-system-databases.js',
    'tests/runtime/quest.test.js'
  ]) {
    const target = path.join(stage, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(root, file), target)
  }
  fs.cpSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), {
    recursive: true
  })
  fs.chmodSync(stage, 0o755)
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--user',
      '1000:1000',
      '--network',
      'none',
      '--memory',
      '512m',
      '--pids-limit',
      '64',
      '--cpus',
      '2',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,size=128m',
      '--mount',
      `type=bind,src=${stage},dst=/app,readonly`,
      '--workdir',
      '/app',
      'node:22-slim',
      'node',
      '--test',
      'tests/runtime/quest.test.js'
    ],
    { stdio: 'inherit', timeout: 90000 }
  )
  if (result.error) throw result.error
  if (result.signal) throw new Error('Quest test container terminated')
  process.exitCode = result.status === 0 ? 0 : 1
} finally {
  fs.rmSync(stage, { recursive: true, force: true })
}
