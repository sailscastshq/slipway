const withDatastoreTransaction = require('../../lib/with-datastore-transaction')

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
    if (!leaseToken) {
      return {
        valid: true,
        deployment: await Deployment.updateOne({ id: deploymentId }).set(values)
      }
    }

    let updated
    await withDatastoreTransaction(async (db) => {
      const [lease, deployment] = await Promise.all([
        DeploymentLease.findOne({
          deployment: deploymentId,
          token: leaseToken,
          expiresAt: { '>': Date.now() }
        }).usingConnection(db),
        Deployment.findOne({ id: deploymentId }).usingConnection(db)
      ])

      if (!lease) {
        return
      }

      if (deployment?.status === 'cancelled') {
        return
      }

      updated = await Deployment.updateOne({ id: deploymentId })
        .set(values)
        .usingConnection(db)
    })

    if (!updated) {
      const deployment = await Deployment.findOne({ id: deploymentId })
      return deployment?.status === 'cancelled'
        ? {
            valid: false,
            code: 'DEPLOYMENT_CANCELLED',
            message: `Deployment ${deploymentId} was cancelled.`
          }
        : {
            valid: false,
            code: 'DEPLOYMENT_LEASE_LOST',
            message: `Deployment ${deploymentId} no longer owns its pipeline lease.`
          }
    }

    return { valid: true, deployment: updated }
  }
}
