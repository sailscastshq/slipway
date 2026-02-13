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
    backupSchedule: {
      type: 'json',
      description: 'Backup schedule config: { enabled, intervalHours }'
    }
  },

  exits: {
    success: {
      description: 'Configuration saved.'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ provider, accessKey, secretKey, bucket, endpoint, region, backupSchedule }) {
    // Handle backup schedule update
    if (backupSchedule !== undefined) {
      const existing = await sails.helpers.setting.get('backupSchedule')
      let current = { enabled: false, intervalHours: 24, lastRunAt: null }
      try { if (existing) current = JSON.parse(existing) } catch { /* ignore */ }

      current.enabled = !!backupSchedule.enabled
      if (backupSchedule.intervalHours) current.intervalHours = backupSchedule.intervalHours

      await sails.helpers.setting.set('backupSchedule', JSON.stringify(current))

      // If only updating schedule (no storage config), return early
      if (!provider) {
        return { success: true }
      }
    }

    // Get existing global env vars
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch { /* ignore parse errors */ }

    // Clear any existing provider keys first
    const keysToRemove = [
      'R2_ACCESS_KEY', 'R2_SECRET_KEY', 'R2_BUCKET', 'R2_ENDPOINT',
      'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT',
      'SPACES_ACCESS_KEY', 'SPACES_SECRET_KEY', 'SPACES_BUCKET', 'SPACES_REGION', 'SPACES_ENDPOINT'
    ]
    for (const key of keysToRemove) {
      delete globalEnvVars[key]
    }

    // Set the new provider keys
    if (provider === 'r2') {
      globalEnvVars.R2_ACCESS_KEY = accessKey
      globalEnvVars.R2_SECRET_KEY = secretKey
      globalEnvVars.R2_BUCKET = bucket
      if (endpoint) globalEnvVars.R2_ENDPOINT = endpoint
    } else if (provider === 's3') {
      globalEnvVars.S3_ACCESS_KEY = accessKey
      globalEnvVars.S3_SECRET_KEY = secretKey
      globalEnvVars.S3_BUCKET = bucket
      if (region) globalEnvVars.S3_REGION = region
      if (endpoint) globalEnvVars.S3_ENDPOINT = endpoint
    } else if (provider === 'spaces') {
      globalEnvVars.SPACES_ACCESS_KEY = accessKey
      globalEnvVars.SPACES_SECRET_KEY = secretKey
      globalEnvVars.SPACES_BUCKET = bucket
      if (region) globalEnvVars.SPACES_REGION = region
      if (endpoint) globalEnvVars.SPACES_ENDPOINT = endpoint
    }

    // Save back to settings
    await sails.helpers.setting.set('globalEnvVars', JSON.stringify(globalEnvVars))

    return { success: true }
  }
}
