const crypto = require('node:crypto')

const {
  buildSailsCompletionSource,
  collectSailsCompletionMetadata,
  emptyHelmCompletions,
  isHelmCompletionMetadata
} = require('../../lib/helm-completions')

module.exports = {
  friendlyName: 'Get Helm completions',

  description:
    'Return secret-free Sails model, helper, and configuration metadata for Helm completion.',

  inputs: {
    containerName: {
      type: 'string',
      description:
        'Optional running app container. When omitted, inspect this Sails app.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName }) {
    if (!containerName) {
      return {
        available: true,
        ...collectSailsCompletionMetadata(sails)
      }
    }

    const result = await sails.helpers.helm.executeInContainer.with({
      containerName,
      source: buildSailsCompletionSource(),
      sourceStartLine: 1,
      sourceStartColumn: 1,
      executionId: crypto.randomUUID()
    })

    if (!result?.success || !isHelmCompletionMetadata(result.value)) {
      return {
        available: false,
        ...emptyHelmCompletions()
      }
    }

    return {
      available: true,
      ...result.value
    }
  }
}
