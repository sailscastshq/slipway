module.exports = {
  friendlyName: 'Update uploads settings',

  description: 'Save S3-compatible storage configuration to global env vars.',

  inputs: {
    provider: {
      type: 'string',
      isIn: ['r2', 's3', 'spaces']
    },
    accessKey: {
      type: 'string'
    },
    secretKey: {
      type: 'string'
    },
    bucket: {
      type: 'string'
    },
    endpoint: {
      type: 'string',
      allowNull: true
    },
    region: {
      type: 'string',
      allowNull: true
    },
    publicUrl: {
      type: 'string',
      allowNull: true
    },
    backupSchedule: {
      type: 'json',
      description: 'Backup schedule config: { enabled, intervalHours }'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    badRequest: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({
    provider,
    accessKey,
    secretKey,
    bucket,
    endpoint,
    region,
    publicUrl,
    backupSchedule
  }) {
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch {
      /* ignore parse errors */
    }

    const prefix = provider ? provider.toUpperCase() : null
    const requiredFields = []
    if (provider) {
      requiredFields.push('provider', 'bucket')
      if (!globalEnvVars[`${prefix}_ACCESS_KEY`]) {
        requiredFields.push('accessKey')
      }
      if (!globalEnvVars[`${prefix}_SECRET_KEY`]) {
        requiredFields.push('secretKey')
      }
      if (provider === 'r2' || provider === 'spaces') {
        requiredFields.push('endpoint')
      }
      if (provider === 's3' || provider === 'spaces') {
        requiredFields.push('region')
      }
    }

    const problems = sails.helpers.setting.validate(
      {
        provider,
        accessKey,
        secretKey,
        bucket,
        endpoint,
        region,
        publicUrl,
        backupSchedule
      },
      requiredFields,
      this.req
    )
    if (problems.length) {
      throw { badRequest: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    // Handle backup schedule update
    if (backupSchedule !== undefined) {
      const existing = await sails.helpers.setting.get('backupSchedule')
      let current = { enabled: false, intervalHours: 24, lastRunAt: null }
      try {
        if (existing) current = JSON.parse(existing)
      } catch {
        /* ignore */
      }

      current.enabled = !!backupSchedule.enabled
      if (backupSchedule.intervalHours)
        current.intervalHours = backupSchedule.intervalHours
      if (backupSchedule.retentionCount)
        current.retentionCount = backupSchedule.retentionCount

      await sails.helpers.setting.set('backupSchedule', JSON.stringify(current))

      // If only updating schedule (no storage config), return early
      if (!provider) {
        sails.inertia.flash('success', 'Backup schedule updated')
        return '/settings/uploads'
      }
    }

    // Preserve existing credentials before clearing
    const existingCredentials = {
      R2_ACCESS_KEY: globalEnvVars.R2_ACCESS_KEY,
      R2_SECRET_KEY: globalEnvVars.R2_SECRET_KEY,
      S3_ACCESS_KEY: globalEnvVars.S3_ACCESS_KEY,
      S3_SECRET_KEY: globalEnvVars.S3_SECRET_KEY,
      SPACES_ACCESS_KEY: globalEnvVars.SPACES_ACCESS_KEY,
      SPACES_SECRET_KEY: globalEnvVars.SPACES_SECRET_KEY
    }

    // Clear any existing provider keys first
    const keysToRemove = [
      'R2_ACCESS_KEY',
      'R2_SECRET_KEY',
      'R2_BUCKET',
      'R2_ENDPOINT',
      'R2_PUBLIC_URL',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_BUCKET',
      'S3_REGION',
      'S3_ENDPOINT',
      'S3_PUBLIC_URL',
      'SPACES_ACCESS_KEY',
      'SPACES_SECRET_KEY',
      'SPACES_BUCKET',
      'SPACES_REGION',
      'SPACES_ENDPOINT',
      'SPACES_PUBLIC_URL'
    ]
    for (const key of keysToRemove) {
      delete globalEnvVars[key]
    }

    // Set the new provider keys (preserve existing credentials if not provided)
    if (provider === 'r2') {
      globalEnvVars.R2_ACCESS_KEY =
        accessKey || existingCredentials.R2_ACCESS_KEY
      globalEnvVars.R2_SECRET_KEY =
        secretKey || existingCredentials.R2_SECRET_KEY
      globalEnvVars.R2_BUCKET = bucket
      if (endpoint) globalEnvVars.R2_ENDPOINT = endpoint
      if (publicUrl) globalEnvVars.R2_PUBLIC_URL = publicUrl
    } else if (provider === 's3') {
      globalEnvVars.S3_ACCESS_KEY =
        accessKey || existingCredentials.S3_ACCESS_KEY
      globalEnvVars.S3_SECRET_KEY =
        secretKey || existingCredentials.S3_SECRET_KEY
      globalEnvVars.S3_BUCKET = bucket
      if (region) globalEnvVars.S3_REGION = region
      if (endpoint) globalEnvVars.S3_ENDPOINT = endpoint
      if (publicUrl) globalEnvVars.S3_PUBLIC_URL = publicUrl
    } else if (provider === 'spaces') {
      globalEnvVars.SPACES_ACCESS_KEY =
        accessKey || existingCredentials.SPACES_ACCESS_KEY
      globalEnvVars.SPACES_SECRET_KEY =
        secretKey || existingCredentials.SPACES_SECRET_KEY
      globalEnvVars.SPACES_BUCKET = bucket
      if (region) globalEnvVars.SPACES_REGION = region
      if (endpoint) globalEnvVars.SPACES_ENDPOINT = endpoint
      if (publicUrl) globalEnvVars.SPACES_PUBLIC_URL = publicUrl
    }

    // Save back to settings
    await sails.helpers.setting.set(
      'globalEnvVars',
      JSON.stringify(globalEnvVars)
    )

    sails.inertia.flash('success', 'Storage configuration saved')
    return '/settings/uploads'
  }
}
