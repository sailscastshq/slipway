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
