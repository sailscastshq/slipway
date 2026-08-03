module.exports = {
  friendlyName: 'Warm Bridge runtime',

  description:
    'Start and verify the reusable Bridge runtime for a running app container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    timeout: {
      type: 'number',
      defaultsTo: 30000
    }
  },

  exits: {
    success: {
      outputType: 'boolean'
    }
  },

  fn: async function ({ containerName, timeout }) {
    const result = await sails.helpers.bridge.executeInContainer.with({
      containerName,
      code: 'return { ready: true }',
      timeout
    })

    if (!result.success) {
      const error = new Error(
        result.error || `Bridge runtime for ${containerName} did not start.`
      )
      error.code = 'BRIDGE_RUNTIME_WARMUP_FAILED'
      throw error
    }

    return true
  }
}
