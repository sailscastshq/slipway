const withDatastoreTransaction = require('../../lib/deployment-datastore-transaction')

module.exports = {
  friendlyName: 'Update deployment for lease',

  description:
    'Atomically fence a Deployment update with its current durable lease.',

  inputs: {
    deploymentId: {
      type: 'string',
      required: true
    },
    leaseToken: {
      type: 'string'
    },
    values: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ deploymentId, leaseToken, values }) {
    try {
      const deployment = await withDatastoreTransaction(
        async (db) =>
          Deployment.updateOne({ id: deploymentId })
            .set(values)
            .usingConnection(db),
        { deploymentId, leaseToken }
      )
      return { valid: true, deployment }
    } catch (error) {
      if (
        ['DEPLOYMENT_LEASE_LOST', 'DEPLOYMENT_CANCELLED'].includes(error.code)
      ) {
        return { valid: false, code: error.code, message: error.message }
      }
      throw error
    }
  }
}
