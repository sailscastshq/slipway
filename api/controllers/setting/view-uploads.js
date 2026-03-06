module.exports = {
  friendlyName: 'View uploads settings',

  description: 'Display the file uploads/storage configuration page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    // Get global env vars to check for S3 configuration
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch { /* ignore parse errors */ }

    // Determine which provider is configured (if any)
    const r2Configured = !!(globalEnvVars.R2_ACCESS_KEY && globalEnvVars.R2_SECRET_KEY && globalEnvVars.R2_BUCKET)
    const s3Configured = !!(globalEnvVars.S3_ACCESS_KEY && globalEnvVars.S3_SECRET_KEY && globalEnvVars.S3_BUCKET)
    const spacesConfigured = !!(globalEnvVars.SPACES_ACCESS_KEY && globalEnvVars.SPACES_SECRET_KEY && globalEnvVars.SPACES_BUCKET)

    // Also check sails.config.uploads as fallback
    const configuredViaEnv = !!(
      sails.config.uploads?.key &&
      sails.config.uploads?.secret &&
      sails.config.uploads?.bucket
    )

    const isConfigured = r2Configured || s3Configured || spacesConfigured || configuredViaEnv

    // Determine the active provider
    let provider = null
    if (r2Configured) provider = 'r2'
    else if (s3Configured) provider = 's3'
    else if (spacesConfigured) provider = 'spaces'
    else if (configuredViaEnv) provider = 'env'

    // Return current values (masked for security)
    const config = {
      // R2
      r2AccessKey: globalEnvVars.R2_ACCESS_KEY ? '••••' + globalEnvVars.R2_ACCESS_KEY.slice(-4) : '',
      r2SecretKey: globalEnvVars.R2_SECRET_KEY ? '••••••••' : '',
      r2Bucket: globalEnvVars.R2_BUCKET || '',
      r2Endpoint: globalEnvVars.R2_ENDPOINT || '',
      r2PublicUrl: globalEnvVars.R2_PUBLIC_URL || '',
      // S3
      s3AccessKey: globalEnvVars.S3_ACCESS_KEY ? '••••' + globalEnvVars.S3_ACCESS_KEY.slice(-4) : '',
      s3SecretKey: globalEnvVars.S3_SECRET_KEY ? '••••••••' : '',
      s3Bucket: globalEnvVars.S3_BUCKET || '',
      s3Region: globalEnvVars.S3_REGION || '',
      s3Endpoint: globalEnvVars.S3_ENDPOINT || '',
      s3PublicUrl: globalEnvVars.S3_PUBLIC_URL || '',
      // Spaces
      spacesAccessKey: globalEnvVars.SPACES_ACCESS_KEY ? '••••' + globalEnvVars.SPACES_ACCESS_KEY.slice(-4) : '',
      spacesSecretKey: globalEnvVars.SPACES_SECRET_KEY ? '••••••••' : '',
      spacesBucket: globalEnvVars.SPACES_BUCKET || '',
      spacesRegion: globalEnvVars.SPACES_REGION || '',
      spacesEndpoint: globalEnvVars.SPACES_ENDPOINT || '',
      spacesPublicUrl: globalEnvVars.SPACES_PUBLIC_URL || ''
    }

    // Get backup schedule
    let backupSchedule = { enabled: false, intervalHours: 24, retentionCount: 10, lastRunAt: null }
    try {
      const scheduleJson = await sails.helpers.setting.get('backupSchedule')
      if (scheduleJson) backupSchedule = JSON.parse(scheduleJson)
    } catch { /* ignore */ }

    return {
      page: 'settings/uploads',
      props: {
        isConfigured,
        provider,
        config,
        backupSchedule
      }
    }
  }
}
