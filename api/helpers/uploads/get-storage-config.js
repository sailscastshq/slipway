module.exports = {
  friendlyName: 'Get upload storage config',

  description:
    'Resolve the configured S3-compatible upload credentials and public URL.',

  inputs: {
    requirePublicUrl: {
      type: 'boolean',
      defaultsTo: false,
      description:
        'Require the provider settings needed to serve uploaded objects publicly.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ requirePublicUrl }) {
    let globalEnvVars = {}

    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      const parsed = JSON.parse(globalJson)
      if (parsed && typeof parsed === 'object') globalEnvVars = parsed
    } catch {
      // A malformed optional setting must not hide valid config/uploads values.
    }

    const uploads = sails.config.uploads || {}
    const candidates = [
      providerConfig('r2', globalEnvVars, {
        region: globalEnvVars.R2_REGION || 'auto'
      }),
      providerConfig('s3', globalEnvVars),
      providerConfig('spaces', globalEnvVars),
      {
        provider: uploads.provider || 'r2',
        key: uploads.key,
        secret: uploads.secret,
        bucket: uploads.bucket,
        endpoint: uploads.endpoint,
        region: uploads.region,
        publicUrl: uploads.publicUrl
      }
    ]
    const config = candidates.find((candidate) =>
      isReady(candidate, { requirePublicUrl })
    )

    if (!config) {
      const partiallyConfigured =
        candidates.find((candidate) => isReady(candidate, {})) ||
        candidates.find(hasAnyValue)
      const error = new Error(
        requirePublicUrl
          ? publicStorageMessage(partiallyConfigured)
          : 'Upload storage is not configured. Add credentials and a bucket for R2, S3, or Spaces.'
      )
      error.code = requirePublicUrl
        ? 'PUBLIC_UPLOAD_STORAGE_NOT_CONFIGURED'
        : 'UPLOAD_STORAGE_NOT_CONFIGURED'
      throw error
    }

    return config
  }
}

function providerConfig(provider, values, overrides = {}) {
  const prefix = provider.toUpperCase()
  return {
    provider,
    key: values[`${prefix}_ACCESS_KEY`],
    secret: values[`${prefix}_SECRET_KEY`],
    bucket: values[`${prefix}_BUCKET`],
    endpoint: values[`${prefix}_ENDPOINT`],
    region: values[`${prefix}_REGION`],
    publicUrl: values[`${prefix}_PUBLIC_URL`],
    ...overrides
  }
}

function isReady(config, { requirePublicUrl }) {
  if (!config.key || !config.secret || !config.bucket) return false
  if (
    ['r2', 'spaces'].includes(config.provider) &&
    !isHttpUrl(config.endpoint)
  ) {
    return false
  }
  if (['s3', 'spaces'].includes(config.provider) && !config.region) return false
  if (requirePublicUrl && !isHttpUrl(config.publicUrl)) return false
  return true
}

function hasAnyValue(config) {
  return Boolean(
    config.key ||
      config.secret ||
      config.bucket ||
      config.endpoint ||
      config.publicUrl
  )
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function publicStorageMessage(config) {
  if (!config) {
    return 'Public image uploads are not configured. Add a storage provider and public URL in Settings → File storage.'
  }
  if (!config.key || !config.secret || !config.bucket) {
    return 'Public image uploads need storage credentials and a bucket. Complete Settings → File storage.'
  }
  if (
    ['r2', 'spaces'].includes(config.provider) &&
    !isHttpUrl(config.endpoint)
  ) {
    return 'Public image uploads need a valid storage endpoint. Complete Settings → File storage.'
  }
  return 'Public image uploads need a valid public URL. Add the bucket public URL or custom domain in Settings → File storage.'
}

module.exports._private = {
  hasAnyValue,
  isHttpUrl,
  isReady,
  providerConfig,
  publicStorageMessage
}
