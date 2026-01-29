/**
 * Setting.js
 *
 * Stores instance-wide configuration settings.
 * These can be updated from the dashboard without restarting the server.
 */

module.exports = {
  tableName: 'settings',
  attributes: {
    key: {
      type: 'string',
      required: true,
      unique: true,
      description: 'Setting key (e.g., instanceUrl, sslEnabled)'
    },
    value: {
      type: 'string',
      allowNull: true,
      description: 'Setting value (stored as string, parsed as needed)'
    },
    description: {
      type: 'string',
      allowNull: true,
      description: 'Human-readable description of the setting'
    }
  }
}
