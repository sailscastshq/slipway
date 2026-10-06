// Bounded test orchestration, not a migration command. No CLI credentials are read.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
if (
  args.length > 1 ||
  args.some((arg) => !['--docker', '--help'].includes(arg))
) {
  console.error(
    'Usage: node scripts/rehearse-coolify-migration.js [--docker|--help]'
  )
  process.exit(1)
}
if (args.includes('--help')) {
  console.log(
    'Default: three synthetic source inventories and offline Slipway contracts.\n' +
      '--docker: existing PostgreSQL, restore and Caddy dependency contracts on a dedicated disposable local Docker runner.\n' +
      'No production migration, three-app container deployment, Redis transfer, or DNS/TLS proof is claimed. See docs/coolify-migration.md.'
  )
  process.exit(0)
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    stdio: 'inherit',
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${path.basename(command)} did not complete successfully`)
  return result
}

const offline = [
  'tests/functional/api/coolify-migration.test.js',
  'tests/functional/api/readiness.test.js',
  'tests/unit/cli/readiness.test.js',
  'tests/unit/cli/migration-rehearsal.test.js',
  'tests/unit/helpers/environment/readiness.test.js',
  'tests/unit/helpers/docker/health-check.test.js',
  'tests/unit/lib/source-workspace.test.js',
  'tests/unit/helpers/deploy/cutover-traffic.test.js',
  'tests/unit/helpers/deploy/deployment-coordinator.test.js',
  'tests/unit/helpers/backup/restore-backup.test.js',
  'tests/functional/api/restore-operations.test.js',
  'tests/functional/api/restore-tests.test.js',
  'tests/functional/pages/bridge-performance.test.js',
  'tests/functional/api/helm.test.js',
  'tests/functional/pages/lookout.test.js'
]
const containers = [
  'tests/contracts/external-postgresql.test.js',
  'tests/contracts/restore-tests.test.js',
  'tests/contracts/custom-service-routes.test.js'
]

try {
  if (args.includes('--docker')) {
    if (process.env.SLIPWAY_MIGRATION_DISPOSABLE !== '1')
      throw new Error(
        'Use only a dedicated disposable Docker runner; set SLIPWAY_MIGRATION_DISPOSABLE=1 after confirming it has no production resources.'
      )
    // The contract helpers resolve sails.config.docker.binaryPath. Do not let
    // inherited runtime overrides select a different executable than preflight.
    const dockerOverrides = Object.keys(process.env).filter(
      (name) =>
        process.env[name] &&
        (name === 'SLIPWAY_DOCKER_BINARY' ||
          /^sails_docker(?:__|$)/i.test(name))
    )
    if (dockerOverrides.length)
      throw new Error(
        `Unset Docker runtime overrides (${dockerOverrides.join(
          ', '
        )}) so the contracts use the guarded Docker executable and context.`
      )
    // Respect the selected context, but reject remote transports before any test.
    const selected =
      process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
        ? process.env.DOCKER_HOST
        : JSON.parse(
            run(
              'docker',
              [
                'context',
                'inspect',
                ...(process.env.DOCKER_CONTEXT
                  ? [process.env.DOCKER_CONTEXT]
                  : [])
              ],
              {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 10000
              }
            ).stdout
          )[0]?.Endpoints?.docker?.Host
    if (!selected?.startsWith('unix://'))
      throw new Error(
        'The Docker rehearsal requires a local Unix socket context.'
      )
    if (!process.env.SLIPWAY_STORAGE_EMULATORS)
      throw new Error(
        'SLIPWAY_STORAGE_EMULATORS must name the prepared local emulator node_modules directory.'
      )
    require.resolve('s3rver', {
      paths: [process.env.SLIPWAY_STORAGE_EMULATORS]
    })
    for (const [name, expected] of [
      ['SLIPWAY_EXTERNAL_PG_IMAGE', 'postgres:17-alpine'],
      ['SLIPWAY_RESTORE_TEST_IMAGE', 'postgres:15-alpine']
    ]) {
      if (process.env[name] && process.env[name] !== expected)
        throw new Error(
          `${name} must be unset or match the documented fixture image.`
        )
    }
    // Deliberately do not download software or images in this script.
    for (const image of [
      'postgres:17-alpine',
      'postgres:15-alpine',
      'node:22-alpine',
      'alpine', // Existing Caddy route-label containers use this local tag.
      'lucaslorentz/caddy-docker-proxy@sha256:f3ebe7e762bccf17ce38b88420f80ce63f69dc548eea0cd6e5f29db2ae2ea062'
    ]) {
      run('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])
    }
  }
  const sounding = path.join(root, 'tests/fixtures/run-sounding-native.cjs')
  if (!fs.existsSync(sounding))
    throw new Error(
      'Install the checkout lockfile dependencies before this rehearsal.'
    )
  run(process.execPath, [
    'scripts/check-docs-config-consistency.js',
    'docs/coolify-migration.md'
  ])
  console.log(
    args.includes('--docker')
      ? 'Running real disposable dependency/route contracts. This is not an integrated three-app migration.'
      : 'Running three synthetic source inventories and offline contracts. Docker/app/data/DNS gates remain unproven.'
  )
  const files = args.includes('--docker') ? containers : offline
  run(process.execPath, [
    sounding,
    'test',
    ...files.flatMap((file) => ['--file', file]),
    '--test-concurrency=1',
    '--test-timeout=120000'
  ])
  console.log(
    'Selected contracts passed. Record the commit and scope; do not mark unrun migration gates as verified.'
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
