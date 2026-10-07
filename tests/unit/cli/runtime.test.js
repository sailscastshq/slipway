const path = require('node:path')
const { pathToFileURL } = require('node:url')

const { test } = require('sounding')

const runtimeModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../../packages/cli/src/lib/runtime.js')
).href

test('CLI accepts the documented Node.js runtime range', async ({ expect }) => {
  const { MINIMUM_NODE_MAJOR, assertSupportedNodeVersion } = await import(
    runtimeModuleUrl
  )

  assertSupportedNodeVersion('22.0.0')
  assertSupportedNodeVersion('24.1.0')
  expect(MINIMUM_NODE_MAJOR).toBe(22)
})

test('CLI rejects runtimes older than the documented minimum', async ({
  expect
}) => {
  const { assertSupportedNodeVersion } = await import(runtimeModuleUrl)
  let error

  try {
    assertSupportedNodeVersion('20.19.0')
  } catch (caughtError) {
    error = caughtError
  }

  expect(error.code).toBe('UNSUPPORTED_NODE_VERSION')
  expect(error.message).toContain('Slipway CLI requires Node.js 22 or newer')
})

test('CLI diagnostic output masks nested credentials and signed URLs while preserving execution metadata', async ({
  expect
}) => {
  const { safeDiagnostic } = await import(
    '../../../packages/cli/src/lib/diagnostic-output.js'
  )
  const safe = safeDiagnostic({
    executionId: 'execution-718',
    success: true,
    count: 22,
    error: {
      message: 'postgres://user:pass@db/main',
      nested: { accessToken: 'canary-718' }
    },
    log: 'Bearer canary-718',
    url: 'https://s3.test/file?X-Amz-Signature=canary-718'
  })
  expect(JSON.stringify(safe).includes('canary-718')).toBe(false)
  expect(safe.executionId).toBe('execution-718')
  expect(safe.count).toBe(22)
  expect(safe.error.message).toBe('postgres://[REDACTED]@db/main')
})
