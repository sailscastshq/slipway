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
    let globalEnvVars = {}
    try {
      const stored = await sails.helpers.setting.get('globalEnvVars', '{}')
      const parsed = JSON.parse(stored)
      if (isPlainObject(parsed)) globalEnvVars = parsed
    } catch {
      // A malformed optional global setting must not expose or replace scoped values.
    }

    const values = {
      ...onlyBridgeValues(globalEnvVars),
      ...onlyBridgeValues(environment.envVars),
      ...onlyBridgeValues(app.envVars)
    }
    const provider = String(values.BRIDGE_STORAGE_PROVIDER || '').toLowerCase()
    if (!['r2', 's3'].includes(provider)) {
      throw storageError(
        'Set BRIDGE_STORAGE_PROVIDER to "r2" or "s3" for this app, environment, or Slipway instance.'
      )
    }

    const prefix = provider === 'r2' ? 'BRIDGE_R2_' : 'BRIDGE_S3_'
    const config = {
      provider,
      key: values[`${prefix}ACCESS_KEY`],
      secret: values[`${prefix}SECRET_KEY`],
      bucket: values[`${prefix}BUCKET`],
      endpoint: values[`${prefix}ENDPOINT`],
      publicUrl: values[`${prefix}PUBLIC_URL`],
      region: values[`${prefix}REGION`] || (provider === 'r2' ? 'auto' : null)
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

function onlyBridgeValues(value) {
  if (!isPlainObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key.startsWith('BRIDGE_'))
  )
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
