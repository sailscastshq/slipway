const { test } = require('sounding')

test('Bridge distinguishes worker failure, invalid output and invalid configuration without caching failures', async ({
  sails,
  expect
}) => {
  const originalExecute = sails.helpers.bridge.executeInContainer
  const originalWrap = sails.helpers.bridge.buildSailsWrapper
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  const outputs = [
    {
      success: false,
      error: 'Killed (exit 137).',
      errorCode: 'BRIDGE_WORKER_KILLED'
    },
    { success: true, output: 'not JSON' },
    {
      success: true,
      output: JSON.stringify({
        models: {},
        config: { resources: { missing: {} } }
      })
    },
    { success: true, output: JSON.stringify({ models: {}, config: {} }) }
  ]
  sails.helpers.bridge.executeInContainer = async () => outputs.shift()
  try {
    for (const errorCode of [
      'BRIDGE_WORKER_KILLED',
      'BRIDGE_INVALID_RESPONSE',
      'BRIDGE_INVALID_CONFIG'
    ]) {
      const result = await sails.helpers.bridge.introspectModels.with({
        containerName: 'introspection-errors-742',
        environmentId: 742
      })
      expect(result.errorCode).toBe(errorCode)
      expect(Boolean(result.error)).toBe(true)
    }
    const recovered = await sails.helpers.bridge.introspectModels.with({
      containerName: 'introspection-errors-742',
      environmentId: 742
    })
    expect(recovered.error).toBe(undefined)
    expect(recovered.models).toEqual({})
    expect(outputs.length).toBe(0)
  } finally {
    sails.helpers.bridge.executeInContainer = originalExecute
    sails.helpers.bridge.buildSailsWrapper = originalWrap
  }
})
