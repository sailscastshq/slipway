/**
 * get-instance-url.js
 *
 * Gets the instance URL with fallback chain:
 * 1. Database setting (instanceUrl) - can be updated from dashboard
 * 2. SLIPWAY_URL environment variable - set during install
 * 3. sails.config.custom.baseUrl - default config value
 */

module.exports = {
  friendlyName: 'Get instance URL',

  description: 'Get the Slipway instance URL from settings, env var, or config.',

  inputs: {},

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function () {
    // 1. Try database setting first (allows changing without restart)
    const dbValue = await sails.helpers.setting.get('instanceUrl')
    if (dbValue) {
      return dbValue
    }

    // 2. Try environment variable (set by install script)
    if (process.env.SLIPWAY_URL) {
      return process.env.SLIPWAY_URL
    }

    // 3. Fall back to config (default: http://localhost:1337)
    return sails.config.custom.baseUrl || `http://localhost:${sails.config.port || 1337}`
  }
}
