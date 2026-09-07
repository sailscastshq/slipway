/**
 * init-cli-auth.js
 *
 * @description :: Initialize a CLI authentication session.
 *                 Returns a code for the user to verify and a login URL.
 */

module.exports = {
  friendlyName: 'Initialize CLI auth',

  description: 'Create a new CLI authentication session.',

  inputs: { protocolVersion: { type: 'number', defaultsTo: 1 } },

  exits: {
    upgradeRequired: { statusCode: 426 },
    busy: { statusCode: 429 },
    success: {
      description: 'CLI auth session created.'
    }
  },

  fn: async function ({ protocolVersion }) {
    this.res.set('Cache-Control', 'no-store')
    if (protocolVersion !== 2) {
      throw {
        upgradeRequired: {
          message: 'Update the Slipway CLI to use secure device authorization.'
        }
      }
    }
    const authSessions = sails.helpers.cli.authSessions()

    const created = authSessions.create()
    if (!created)
      throw { busy: { message: 'CLI authorization is busy. Try again later.' } }
    const { code, deviceCode, expiresAt } = created

    // Build the authorization URL using instance URL (from DB, env, or config)
    const instanceUrl = await sails.helpers.getInstanceUrl()
    const loginUrl = `${instanceUrl}/cli/authorize?code=${code}`

    return {
      code,
      deviceCode,
      protocolVersion: 2,
      loginUrl,
      expiresAt
    }
  }
}
