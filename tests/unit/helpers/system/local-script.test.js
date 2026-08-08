const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const appRoot = path.resolve(__dirname, '../../../../')

test('local dev scripts preserve production-like Docker assumptions', async ({
  expect
}) => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')
  )
  const script = fs.readFileSync(path.join(appRoot, 'local.sh'), 'utf8')

  expect(packageJson.scripts.local).toBe('bash ./local.sh')
  expect(packageJson.scripts['local:rebuild']).toBe('bash ./local.sh rebuild')
  expect(packageJson.scripts['local:upgrade-check']).toBe(
    'bash ./local.sh upgrade-check'
  )
  expect(packageJson.scripts['local:stop']).toBe('bash ./local.sh stop')
  expect(packageJson.scripts['local:down']).toBe('bash ./local.sh down')
  expect(packageJson.scripts['local:destroy']).toBe('bash ./local.sh destroy')
  expect(packageJson.scripts['local:logs']).toBe('bash ./local.sh logs')
  expect(packageJson.scripts['local:status']).toBe('bash ./local.sh status')
  expect(packageJson.scripts['local:shell']).toBe('bash ./local.sh shell')
  expect(script.includes('docker build')).toBe(true)
  expect(script.includes('docker network create "$NETWORK_NAME"')).toBe(true)
  expect(script.includes('docker stop "$CONTAINER_NAME"')).toBe(true)
  expect(script.includes('docker volume rm -f')).toBe(true)
  expect(script.includes('npm run dev')).toBe(true)
  expect(script.includes('NODE_ENV=development')).toBe(true)
  expect(script.includes('/var/run/docker.sock')).toBe(true)
  expect(script.includes('/var/slipway/apps')).toBe(true)
  expect(script.includes('/app/db')).toBe(true)
  expect(script.includes('/health')).toBe(true)
  expect(script.includes('.tmp/local')).toBe(true)
  expect(script.includes('check_upgrade_from_previous_release()')).toBe(true)
  expect(script.includes('NODE_ENV=production')).toBe(true)
  expect(script.includes('previous_image')).toBe(true)
  expect(script.includes('candidate_container')).toBe(true)
})

test('production bootstrap adds App columns before hydrating App records', async ({
  expect
}) => {
  const bootstrap = fs.readFileSync(
    path.join(appRoot, 'config/bootstrap.js'),
    'utf8'
  )
  const bridgeSchema = bootstrap.indexOf('sails.helpers.bridge.ensureSchema()')
  const bearingSchema = bootstrap.indexOf(
    'sails.helpers.bearing.ensureSchema()'
  )
  const configurationMigration = bootstrap.indexOf(
    'sails.helpers.configuration.ensureSchema()'
  )

  expect(bridgeSchema > -1).toBe(true)
  expect(bearingSchema > -1).toBe(true)
  expect(configurationMigration > -1).toBe(true)
  expect(bridgeSchema < configurationMigration).toBe(true)
  expect(bearingSchema < configurationMigration).toBe(true)
})
