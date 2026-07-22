module.exports = {
  friendlyName: 'Get backup storage config',

  description:
    'Resolve the configured S3-compatible backup storage credentials.',

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function () {
    let globalEnvVars = {}

    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      const parsed = JSON.parse(globalJson)
      if (parsed && typeof parsed === 'object') globalEnvVars = parsed
    } catch {
      // A malformed optional setting must not hide valid config/uploads values.
    }

    const uploads = sails.config.uploads || {}
    const config = {
      key:
        globalEnvVars.R2_ACCESS_KEY ||
        globalEnvVars.S3_ACCESS_KEY ||
        globalEnvVars.SPACES_ACCESS_KEY ||
        uploads.key,
      secret:
        globalEnvVars.R2_SECRET_KEY ||
        globalEnvVars.S3_SECRET_KEY ||
        globalEnvVars.SPACES_SECRET_KEY ||
        uploads.secret,
      bucket:
        globalEnvVars.R2_BUCKET ||
        globalEnvVars.S3_BUCKET ||
        globalEnvVars.SPACES_BUCKET ||
        uploads.bucket,
      endpoint:
        globalEnvVars.R2_ENDPOINT ||
        globalEnvVars.S3_ENDPOINT ||
        globalEnvVars.SPACES_ENDPOINT ||
        uploads.endpoint,
      region:
        globalEnvVars.S3_REGION || globalEnvVars.SPACES_REGION || uploads.region
    }

    if (!config.key || !config.secret || !config.bucket) {
      const error = new Error(
        'Backup storage not configured. Go to Settings > Global Environment and set the credentials, bucket, and endpoint for R2, S3, or Spaces.'
      )
      error.code = 'BACKUP_STORAGE_NOT_CONFIGURED'
      throw error
    }

    return config
  }
}
