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
    let globalEnvVarMetadata = {}
    try {
      globalEnvVars = JSON.parse(globalEnvJson)
    } catch {
      globalEnvVars = {}
    }
    try {
      globalEnvVarMetadata = JSON.parse(
        await sails.helpers.setting.get('globalEnvVarMetadata', '{}')
      )
    } catch {
      globalEnvVarMetadata = {}
    }

    // Check if backup storage is configured
    const backupConfigured = !!(
      globalEnvVars.R2_ACCESS_KEY &&
      globalEnvVars.R2_SECRET_KEY &&
      globalEnvVars.R2_BUCKET
    )
    globalEnvVarMetadata =
      sails.helpers.configuration.normalizeEnvVarMetadata.with({
        values: globalEnvVars,
        metadata: globalEnvVarMetadata,
        currentValues: globalEnvVars,
        currentMetadata: globalEnvVarMetadata,
        recordChanges: false
      })

    return {
      page: 'settings/global-env',
      props: {
        globalEnvVars,
        globalEnvVarMetadata,
        backupConfigured
      }
    }
  }
}
