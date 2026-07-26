module.exports = {
  friendlyName: 'Find cleanup operation',

  description:
    'Find an operation by immutable target identity, or the latest request-path operation after the target is gone.',

  inputs: {
    targetKey: {
      type: 'string'
    },
    requestKey: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ targetKey, requestKey }) {
    if (targetKey) {
      return CleanupOperation.findOne({ targetKey })
    }

    const operations = await CleanupOperation.find({ requestKey })
      .sort(['createdAt DESC', 'id DESC'])
      .limit(1)
    return operations[0] || null
  }
}
