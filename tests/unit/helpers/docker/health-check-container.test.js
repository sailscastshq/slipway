const { test } = require('sounding')

const { buildProbeArgs, normalizePath, waitForContainerHttp } =
  require('../../../../api/helpers/docker/health-check-container')._private

test('candidate health checks execute inside the target container', async ({
  expect
}) => {
  const attempts = []
  let now = 0

  const result = await waitForContainerHttp({
    execute: async (binary, args) => {
      attempts.push([binary, ...args])
      if (attempts.length < 3) {
        throw new Error('curl: connection refused')
      }
    },
    dockerPath: '/usr/bin/docker',
    containerName: 'slipway-next',
    port: 1337,
    path: '/health',
    timeout: 10000,
    interval: 2000,
    clock: {
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds
      }
    }
  })

  expect(result.attempts).toBe(3)
  expect(attempts[0]).toEqual([
    '/usr/bin/docker',
    'exec',
    'slipway-next',
    'curl',
    '-fsS',
    '--max-time',
    '5',
    'http://localhost:1337/health'
  ])
})

test('candidate health checks retain the final in-container error', async ({
  expect
}) => {
  let now = 0
  let thrown

  try {
    await waitForContainerHttp({
      execute: async () => {
        const error = new Error('docker exec failed')
        error.stderr = 'candidate is not running'
        throw error
      },
      dockerPath: 'docker',
      containerName: 'slipway-next',
      port: 1337,
      path: 'health',
      timeout: 4000,
      interval: 2000,
      clock: {
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds
        }
      }
    })
  } catch (error) {
    thrown = error
  }

  expect(thrown.code).toBe('CONTAINER_HEALTH_CHECK_FAILED')
  expect(thrown.message.includes('candidate is not running')).toBe(true)
  expect(thrown.message.includes('after 2 attempts')).toBe(true)
})

test('candidate health paths and probe timeouts are normalized', async ({
  expect
}) => {
  expect(normalizePath('health')).toBe('/health')
  expect(normalizePath('')).toBe('/health')
  expect(
    buildProbeArgs({
      containerName: 'candidate',
      endpoint: 'http://localhost:1337/health',
      probeTimeout: 1200
    })
  ).toEqual([
    'exec',
    'candidate',
    'curl',
    '-fsS',
    '--max-time',
    '2',
    'http://localhost:1337/health'
  ])
})
