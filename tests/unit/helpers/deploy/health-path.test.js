const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const appRoot = path.resolve(__dirname, '../../../../')

test('deploy pipeline probes the app readiness path before switching traffic', async ({
  expect
}) => {
  const source = fs.readFileSync(
    path.join(appRoot, 'api/helpers/deploy/execute-pipeline.js'),
    'utf8'
  )
  const healthPathIndex = source.indexOf(
    'const healthPath = App.normalizeHealthPath'
  )
  const healthCheckIndex = source.indexOf(
    'await sails.helpers.docker.healthCheck.with({'
  )
  const appRecordIndex = source.indexOf('// 11. Update App record')
  const routeIndex = source.indexOf('// 12. Update Caddy reverse proxy route')

  expect(healthPathIndex > -1).toBe(true)
  expect(source.includes('path: healthPath')).toBe(true)
  expect(source.includes('healthPath,')).toBe(true)
  expect(healthPathIndex < healthCheckIndex).toBe(true)
  expect(healthCheckIndex < appRecordIndex).toBe(true)
  expect(appRecordIndex < routeIndex).toBe(true)
})

test('rollback probes the app readiness path before switching traffic', async ({
  expect
}) => {
  const source = fs.readFileSync(
    path.join(appRoot, 'api/controllers/api/v1/deploy/rollback-deployment.js'),
    'utf8'
  )
  const healthPathIndex = source.indexOf(
    'const healthPath = App.normalizeHealthPath'
  )
  const healthCheckIndex = source.indexOf(
    'await sails.helpers.docker.healthCheck.with({'
  )
  const appRecordIndex = source.indexOf('// 9. Create or update the App record')
  const routeIndex = source.indexOf('// 10. Update Caddy reverse proxy route')

  expect(healthPathIndex > -1).toBe(true)
  expect(source.includes('path: healthPath')).toBe(true)
  expect(source.includes('healthPath,')).toBe(true)
  expect(healthPathIndex < healthCheckIndex).toBe(true)
  expect(healthCheckIndex < appRecordIndex).toBe(true)
  expect(appRecordIndex < routeIndex).toBe(true)
})
