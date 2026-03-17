/**
 * get-server-ip.js
 *
 * Gets the server's public IP address with fallback chain:
 * 1. Database setting (serverIp) - set from dashboard or install
 * 2. SLIPWAY_URL environment variable - extract host/IP from URL
 * 3. Fallback to 127.0.0.1
 *
 * Used for custom domain A-record instructions and server identification.
 */

module.exports = {
  friendlyName: 'Get server IP',

  description:
    'Get the server IP from settings, env var, or fallback to 127.0.0.1.',

  inputs: {},

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function () {
    // 1. Try database setting first (allows changing without restart)
    const dbValue = await sails.helpers.setting.get('serverIp')
    if (dbValue) {
      return dbValue
    }

    // 2. Try extracting from SLIPWAY_URL env var
    if (process.env.SLIPWAY_URL) {
      try {
        const url = new URL(process.env.SLIPWAY_URL)
        const host = url.hostname
        // Only use if it looks like an IP address (not a hostname)
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
          return host
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }

    // 3. Fallback
    return '127.0.0.1'
  }
}
