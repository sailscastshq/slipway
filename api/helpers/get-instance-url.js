/**
 * get-instance-url.js
 *
 * Gets the instance URL with fallback chain:
 * 1. instanceDomain setting (set from settings UI, bare domain)
 * 2. instanceUrl setting (legacy, full URL)
 * 3. SLIPWAY_URL environment variable - set during install
 * 4. sails.config.custom.baseUrl - default config value
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
    // 1. Try instanceDomain first (set from settings UI)
    const instanceDomain = await sails.helpers.setting.get('instanceDomain')
    if (instanceDomain) {
      const domain = instanceDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
      return `https://${domain}`
    }

    // 2. Try instanceUrl setting (legacy)
    const dbValue = await sails.helpers.setting.get('instanceUrl')
    if (dbValue) {
      return dbValue
    }

    // 3. Try environment variable (set by install script)
    if (process.env.SLIPWAY_URL) {
      return process.env.SLIPWAY_URL
    }

    // 4. Fall back to config (default: http://localhost:1337)
    return sails.config.custom.baseUrl || `http://localhost:${sails.config.port || 1337}`
  }
}
