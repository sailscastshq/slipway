module.exports = {
  friendlyName: 'View global environment',

  description: 'Display the global environment variables settings page.',

  inputs: {},

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    const globalEnvJson = await sails.helpers.setting.get('globalEnvVars', '{}')
    let globalEnvVars = {}
    try {
      globalEnvVars = JSON.parse(globalEnvJson)
    } catch {
      globalEnvVars = {}
    }

    // Check if backup storage is configured
    const backupConfigured = !!(
      globalEnvVars.R2_ACCESS_KEY &&
      globalEnvVars.R2_SECRET_KEY &&
      globalEnvVars.R2_BUCKET
    )

    return {
      page: 'settings/global-env',
      props: {
        globalEnvVars,
        backupConfigured
      }
    }
  }
}
