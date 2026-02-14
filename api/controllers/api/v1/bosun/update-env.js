/**
 * update-env.js
 *
 * Save instance environment variable overrides to the Setting model.
 */

module.exports = {
  friendlyName: 'Update instance env vars',

  description: 'Persist instance environment variable overrides.',

  inputs: {
    envVars: {
      type: {},
      required: true
    }
  },

  exits: {
    success: {
      responseType: ''
    }
  },

  fn: async function ({ envVars }) {
    await sails.helpers.setting.set('instanceEnvVars', JSON.stringify(envVars))
    return { success: true }
  }
}
