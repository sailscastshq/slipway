/**
 * DeploymentLease.js
 *
 * Renewable, fenced ownership of one environment deployment target.
 */

module.exports = {
  tableName: 'deployment_leases',

  attributes: {
    targetKey: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'target_key'
    },

    deployment: {
      model: 'deployment',
      required: true,
      unique: true,
      columnName: 'deployment_id'
    },

    token: {
      type: 'string',
      required: true,
      unique: true
    },

    owner: {
      type: 'string',
      required: true
    },

    stage: {
      type: 'string',
      defaultsTo: 'claimed'
    },

    heartbeatAt: {
      type: 'number',
      required: true,
      columnName: 'heartbeat_at'
    },

    expiresAt: {
      type: 'number',
      required: true,
      columnName: 'expires_at'
    }
  }
}
