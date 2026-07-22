const childProcess = require('node:child_process')
const path = require('node:path')
const { promisify } = require('node:util')

const { test } = require('sounding')

const helperPath = path.resolve(
  __dirname,
  '../../../../api/helpers/caddy/verify-route.js'
)

test('route verification requires Caddy to accept the generated configuration', async ({
  expect
}) => {
  const calls = []
  const helper = loadHelperWithExec(async (dockerPath, args) => {
    calls.push({ dockerPath, args })
    return {
      stdout: args.includes('adapt')
        ? '{"dial":"slipway-web-candidate:1337"}'
        : '',
      stderr: ''
    }
  })

  const result = await helper.fn({
    expectedUpstreams: ['slipway-web-candidate:1337'],
    timeoutMs: 100
  })

  expect(result.expectedUpstreams).toEqual(['slipway-web-candidate:1337'])
  expect(calls.map(({ args }) => args[3])).toEqual(['adapt', 'reload'])
  expect(calls[1].args).toEqual([
    'exec',
    'slipway-proxy',
    'caddy',
    'reload',
    '--config',
    '/config/caddy/Caddyfile.autosave',
    '--adapter',
    'caddyfile'
  ])
})

test('Caddy admin API failure fails route verification explicitly', async ({
  expect
}) => {
  const helper = loadHelperWithExec(async (dockerPath, args) => {
    if (args.includes('adapt')) {
      return {
        stdout: '{"dial":"slipway-web-candidate:1337"}',
        stderr: ''
      }
    }

    throw new Error('Caddy admin endpoint unavailable')
  })

  const error = await captureError(
    helper.fn({
      expectedUpstreams: ['slipway-web-candidate:1337'],
      timeoutMs: 1
    })
  )

  expect(error.code).toBe('CADDY_ROUTE_VERIFICATION_FAILED')
  expect(error.message).toContain('Caddy admin endpoint unavailable')
})

test('route verification rejects stale upstreams after cutover', async ({
  expect
}) => {
  const helper = loadHelperWithExec(async () => ({
    stdout:
      '{"dial":"slipway-web-candidate:1337"}{"dial":"slipway-web-previous:1337"}',
    stderr: ''
  }))

  const error = await captureError(
    helper.fn({
      expectedUpstreams: ['slipway-web-candidate:1337'],
      excludedUpstreams: ['slipway-web-previous:1337'],
      timeoutMs: 1
    })
  )

  expect(error.code).toBe('CADDY_ROUTE_VERIFICATION_FAILED')
  expect(error.message).toContain('still includes slipway-web-previous:1337')
})

test('route verification can confirm that a first candidate was removed', async ({
  expect
}) => {
  const calls = []
  const helper = loadHelperWithExec(async (dockerPath, args) => {
    calls.push(args)
    return { stdout: '{"dial":"unrelated-app:1337"}', stderr: '' }
  })

  const result = await helper.fn({
    expectedUpstreams: [],
    excludedUpstreams: ['slipway-web-candidate:1337'],
    timeoutMs: 100
  })

  expect(result.expectedUpstreams).toEqual([])
  expect(calls.map((args) => args[3])).toEqual(['adapt', 'reload'])
})

function loadHelperWithExec(fakeExecFile) {
  const originalExecFile = childProcess.execFile
  const stubExecFile = () => {}
  stubExecFile[promisify.custom] = fakeExecFile

  childProcess.execFile = stubExecFile
  delete require.cache[require.resolve(helperPath)]

  try {
    return require(helperPath)
  } finally {
    childProcess.execFile = originalExecFile
    delete require.cache[require.resolve(helperPath)]
  }
}

async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error('Expected operation to fail.')
}
