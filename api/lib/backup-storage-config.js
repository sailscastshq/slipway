function invalid(field, message) {
  const error = new Error(message)
  error.field = field
  error.code = 'STORAGE_CONFIGURATION'
  throw error
}
function resolve(input, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid('provider', 'Choose a supported backup storage provider.')
  const provider = input.provider
  if (!['shared', 's3', 'azure'].includes(provider))
    invalid('provider', 'Choose a supported backup storage provider.')
  if (provider === 'shared') return { provider }
  const same = previous.provider === provider
  const secret = (name) =>
    String(input[name] || (same ? previous[name] : '') || '').trim()
  const config = {
    provider,
    bucket: String(input.bucket || '').trim(),
    endpoint: String(input.endpoint || '').trim(),
    allowInsecure: input.allowInsecure === true
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket))
    invalid(
      'bucket',
      'Enter a valid container or bucket name (3–63 lowercase characters).'
    )
  if (config.endpoint) {
    let url
    try {
      url = new URL(config.endpoint)
    } catch {
      invalid('endpoint', 'Enter a valid HTTPS storage endpoint.')
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['https:', 'http:'].includes(url.protocol)
    )
      invalid(
        'endpoint',
        'Keep credentials out of the endpoint. Use an HTTPS URL without query parameters.'
      )
    if (url.protocol === 'http:' && !config.allowInsecure)
      invalid(
        'endpoint',
        'HTTP requires explicit approval for a trusted private network. HTTPS is recommended.'
      )
    config.endpoint = url.toString().replace(/\/$/, '')
  }
  if (provider === 's3') {
    Object.assign(config, {
      key: secret('key'),
      secret: secret('secret'),
      region: String(input.region || 'us-east-1').trim()
    })
    if (!config.key) invalid('key', 'Enter the access key.')
    if (!config.secret) invalid('secret', 'Enter the secret key.')
    if (!/^[a-z0-9-]{1,63}$/.test(config.region))
      invalid('region', 'Enter a valid storage region.')
  } else {
    config.account = String(input.account || '').trim()
    config.authMethod =
      input.authMethod === 'account-key' ? 'account-key' : 'sas'
    if (!/^[a-z0-9]{3,24}$/.test(config.account))
      invalid('account', 'Enter the Azure storage account name.')
    if (
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      config.bucket.includes('--')
    )
      invalid('bucket', 'Enter a valid Azure container name.')
    if (config.authMethod === 'sas') {
      config.sasToken = secret('sasToken').replace(/^\?/, '')
      const token = new URLSearchParams(config.sasToken)
      if (
        token.get('sr') !== 'c' ||
        !token.get('sig') ||
        !['r', 'w', 'd'].every((permission) =>
          (token.get('sp') || '').includes(permission)
        ) ||
        !(Date.parse(token.get('se')) > Date.now())
      )
        invalid(
          'sasToken',
          'Use a container-scoped SAS token with read, write, delete, and a future expiry.'
        )
    } else {
      config.accountKey = secret('accountKey')
      if (
        !/^[A-Za-z0-9+/]+={0,2}$/.test(config.accountKey) ||
        Buffer.from(config.accountKey, 'base64').length !== 64
      )
        invalid(
          'accountKey',
          'Enter a valid Azure account key, or choose a scoped SAS token.'
        )
    }
  }
  return config
}
function publicConfig(config = { provider: 'shared' }) {
  return {
    provider: config.provider,
    bucket: config.bucket || '',
    endpoint: config.endpoint || '',
    region: config.region || 'us-east-1',
    account: config.account || '',
    authMethod: config.authMethod || 'sas',
    allowInsecure: config.allowInsecure === true,
    hasCredentials: Boolean(
      config.secret || config.sasToken || config.accountKey
    )
  }
}
async function saved() {
  const record = await Setting.findOne({ key: 'backupStorageConfig' }).decrypt()
  try {
    return record?.encryptedValue
      ? JSON.parse(record.encryptedValue)
      : { provider: 'shared' }
  } catch {
    invalid(
      'provider',
      'The saved backup storage configuration could not be read. Save it again.'
    )
  }
}
module.exports = { resolve, publicConfig, saved }
