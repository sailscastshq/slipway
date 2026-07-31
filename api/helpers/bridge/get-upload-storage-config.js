module.exports = {
  friendlyName: 'Get Bridge upload storage config',

  description:
    'Resolve app, environment, and instance-scoped BRIDGE_ upload settings.',

  inputs: {
    app: {
      type: 'ref',
      required: true
    },
    environment: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ app, environment }) {
    const scopes = await resolveStorageScopes({ app, environment })
    const provider = resolveProvider(scopes)
    if (!['r2', 's3'].includes(provider)) {
      throw storageError(
        'Set BRIDGE_STORAGE_PROVIDER to "r2" or "s3", or configure a complete conventional R2_ or S3_ credential set.'
      )
    }

    const config = {
      provider,
      key: resolveStorageValue(scopes, provider, 'ACCESS_KEY'),
      secret: resolveStorageValue(scopes, provider, 'SECRET_KEY'),
      bucket: resolveStorageValue(scopes, provider, 'BUCKET'),
      endpoint: resolveStorageValue(scopes, provider, 'ENDPOINT'),
      publicUrl: resolveStorageValue(scopes, provider, 'PUBLIC_URL'),
      region:
        resolveStorageValue(scopes, provider, 'REGION') ||
        (provider === 'r2' ? 'auto' : null)
    }

    const missing = ['key', 'secret', 'bucket'].filter(
      (name) => !readString(config[name])
    )
    if (provider === 'r2' && !readString(config.endpoint)) {
      missing.push('endpoint')
    }
    if (!readString(config.publicUrl)) {
      missing.push('public URL')
    }
    if (missing.length > 0) {
      throw storageError(
        `Bridge ${provider.toUpperCase()} storage is missing: ${missing.join(
          ', '
        )}.`
      )
    }

    assertHttpUrl(config.publicUrl, 'Bridge storage public URL', {
      requireBase: true
    })
    if (config.endpoint) {
      assertHttpUrl(config.endpoint, 'Bridge storage endpoint')
    }

    return config
  }
}

async function resolveStorageScopes({ app, environment }) {
  if (app.id && environment.id) {
    const runtimeConfig =
      await sails.helpers.configuration.resolveRuntimeConfig.with({
        environmentId: String(environment.id),
        appId: String(app.id)
      })
    return runtimeConfig.scopes.map((scope) => storageValues(scope.values))
  }

  const globalValues = parseObject(
    await sails.helpers.setting.get('globalEnvVars', '{}')
  )
  return [
    storageValues(globalValues),
    storageValues(environment.envVars),
    storageValues(app.secureEnvVars || app.envVars)
  ]
}

function storageValues(value) {
  if (!isPlainObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) =>
        key.startsWith('BRIDGE_') ||
        key.startsWith('R2_') ||
        key.startsWith('S3_')
    )
  )
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(value || '{}')
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function resolveProvider(scopes) {
  const configured = String(
    resolveScopedValue(scopes, ['BRIDGE_STORAGE_PROVIDER']) || ''
  ).toLowerCase()
  if (configured) return configured

  const hasR2 = hasCredentials(scopes, 'r2')
  const hasS3 = hasCredentials(scopes, 's3')
  if (hasR2 && hasS3) {
    throw storageError(
      'Both R2 and S3 credentials are configured. Set BRIDGE_STORAGE_PROVIDER explicitly.'
    )
  }
  if (hasR2) return 'r2'
  if (hasS3) return 's3'
  return ''
}

function hasCredentials(scopes, provider) {
  const required = ['ACCESS_KEY', 'SECRET_KEY', 'BUCKET']
  if (provider === 'r2') required.push('ENDPOINT')
  return required.every((name) =>
    readString(resolveStorageValue(scopes, provider, name))
  )
}

function resolveStorageValue(scopes, provider, suffix) {
  const name = provider === 'r2' ? 'R2' : 'S3'
  return resolveScopedValue(scopes, [
    `BRIDGE_${name}_${suffix}`,
    `${name}_${suffix}`
  ])
}

function resolveScopedValue(scopes, names) {
  for (let index = scopes.length - 1; index >= 0; index--) {
    for (const name of names) {
      const value = scopes[index][name]
      if (readString(value)) return value
    }
  }
  return undefined
}

function storageError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_UPLOAD_STORAGE_NOT_CONFIGURED'
  return error
}

function assertHttpUrl(value, label, { requireBase = false } = {}) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw storageError(`${label} is invalid.`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw storageError(`${label} must use HTTP or HTTPS.`)
  }
  if (requireBase && (url.search || url.hash)) {
    throw storageError(`${label} must not include a query string or fragment.`)
  }
}

function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isPlainObject(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
}
