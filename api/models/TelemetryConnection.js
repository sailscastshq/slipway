/**
 * TelemetryConnection.js
 *
 * Durable registration for the sails-hook-slipway runtime currently serving
 * an app. Unlike retained spans and metrics, this record survives quiet
 * periods so Lookout can distinguish installation from connectivity.
 */

module.exports = {
  datastore: 'observability',
  tableName: 'telemetry_connections',

  attributes: {
    app: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'app_id'
    },

    environment: {
      type: 'string',
      required: true
    },

    deployment: {
      type: 'string',
      allowNull: true,
      columnName: 'deployment_id'
    },

    hookVersion: {
      type: 'string',
      required: true,
      columnName: 'hook_version'
    },

    protocolVersion: {
      type: 'number',
      required: true,
      columnName: 'protocol_version'
    },

    capabilities: {
      type: 'json',
      defaultsTo: {}
    },

    enabled: {
      type: 'boolean',
      defaultsTo: true
    },

    startedAt: {
      type: 'number',
      required: true,
      columnName: 'started_at'
    },

    lastSeenAt: {
      type: 'number',
      required: true,
      columnName: 'last_seen_at'
    }
  }
}
