/**
 * init-cli-auth.js
 *
 * @description :: Initialize a CLI authentication session.
 *                 Returns a code for the user to verify and a login URL.
 */

module.exports = {
  friendlyName: 'Initialize CLI auth',

  description: 'Create a new CLI authentication session.',

  inputs: {},

  exits: {
    success: {
      description: 'CLI auth session created.'
    }
  },

  fn: async function () {
    const authSessions = sails.helpers.cli.authSessions()

    const { code, expiresAt } = authSessions.create()

    // Build the authorization URL using instance URL (from DB, env, or config)
    const instanceUrl = await sails.helpers.getInstanceUrl()
    const loginUrl = `${instanceUrl}/cli/authorize?code=${code}`

    return {
      code,
      loginUrl,
      expiresAt
    }
  }
}
