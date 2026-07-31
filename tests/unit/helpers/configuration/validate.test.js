const { test } = require('sounding')

test('configuration validation accepts production-safe values', async ({
  sails,
  expect
}) => {
  const problems = sails.helpers.configuration.validate(
    {
      name: 'Web worker',
      description: 'Processes background jobs.',
      repositoryUrl: 'https://github.com/sailscastshq/slipway',
      autoDeploy: true,
      autoDeployBranch: 'feat/safe-release',
      dockerfilePath: 'docker/Dockerfile.worker',
      healthPath: '/health',
      routePath: null,
      domain: 'worker.example.com',
      resourceLimits: { cpus: '0.5', memory: '512m' }
    },
    ['name', 'dockerfilePath', 'healthPath']
  )

  expect(problems).toEqual([])
})

test('configuration validation rejects unsafe paths and resource limits', async ({
  sails,
  expect
}) => {
  const problems = sails.helpers.configuration.validate({
    dockerfilePath: '../Dockerfile',
    healthPath: 'https://example.com/health',
    routePath: '/api/',
    domain: 'https://example.com',
    resourceLimits: { cpus: '0', memory: '2m' }
  })
  const errors = Object.assign({}, ...problems)

  expect(Boolean(errors.dockerfilePath)).toBe(true)
  expect(Boolean(errors.healthPath)).toBe(true)
  expect(Boolean(errors.routePath)).toBe(true)
  expect(Boolean(errors.domain)).toBe(true)
  expect(Boolean(errors['resourceLimits.cpus'])).toBe(true)
  expect(Boolean(errors['resourceLimits.memory'])).toBe(true)
})
