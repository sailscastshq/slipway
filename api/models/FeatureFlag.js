/**
 * FeatureFlag.js
 *
 * A boolean release flag for one app in one environment.
 */

module.exports = {
  tableName: 'feature_flags',

  attributes: {
    key: {
      type: 'string',
      required: true,
      regex: /^[a-z][a-z0-9-]{0,63}$/,
      description: 'Stable application-facing flag key'
    },

    description: {
      type: 'string',
      allowNull: true,
      maxLength: 160
    },

    enabled: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Master release switch; false is the kill switch'
    },

    rolloutPercentage: {
      type: 'number',
      defaultsTo: 0,
      min: 0,
      max: 100,
      columnName: 'rollout_percentage'
    },

    targets: {
      type: 'json',
      defaultsTo: [],
      description:
        'Typed allowlist entries such as user:42, account:acme, or tenant:north'
    },

    version: {
      type: 'number',
      defaultsTo: 1
    },

    changedByName: {
      type: 'string',
      allowNull: true,
      columnName: 'changed_by_name'
    },

    changedBy: {
      model: 'user',
      columnName: 'changed_by'
    },

    environment: {
      model: 'environment',
      required: true
    },

    app: {
      model: 'app',
      required: true
    }
  }
}
