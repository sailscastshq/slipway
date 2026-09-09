const { X509Certificate } = require('node:crypto')
function invalid(message) {
  const error = new Error(message)
  error.code = 'EXTERNAL_CONFIGURATION'
  throw error
}
function parse(input) {
  let url
  try {
    url = new URL(input?.dsn)
  } catch {
    invalid('Enter a PostgreSQL connection URL.')
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.pathname.length < 2 ||
    url.hash
  )
    invalid('Include a host, database and username in the PostgreSQL URL.')
  const sslMode = input.sslMode || 'verify-full'
  if (!['verify-full', 'require', 'disable'].includes(sslMode))
    invalid('Choose a supported TLS mode.')
  if (sslMode !== 'verify-full' && input.allowInsecure !== true)
    invalid(
      'Acknowledge the TLS risk before using an unverified or unencrypted connection.'
    )
  for (const key of url.searchParams.keys())
    if (key !== 'sslmode')
      invalid(
        'Set TLS options in the form; other URL parameters are not supported.'
      )
  if (
    url.searchParams.has('sslmode') &&
    url.searchParams.get('sslmode') !== sslMode
  )
    invalid('The URL TLS mode must match the selected TLS mode.')
  const config = {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode,
    caCertificate: String(input.caCertificate || '').trim()
  }
  for (const name of ['host', 'database', 'username', 'password'])
    if (/[\r\n\0]/.test(config[name]) || config[name].length > 4096)
      invalid('Connection fields must be single-line values.')
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    invalid('Enter a valid PostgreSQL port.')
  if (config.caCertificate) {
    if (config.caCertificate.length > 65536 || sslMode !== 'verify-full')
      invalid(
        'A custom CA requires verified TLS and must be smaller than 64 KiB.'
      )
    try {
      new X509Certificate(config.caCertificate)
    } catch {
      invalid('Enter a PEM-encoded CA certificate.')
    }
  }
  for (const name of ['host', 'database', 'username'])
    if (config[name] !== config[name].trim())
      invalid(
        'Host, database and username cannot have leading or trailing whitespace.'
      )
  return config
}
function connectionUrl(config) {
  const host = config.host.includes(':') ? `[${config.host}]` : config.host
  return `postgresql://${encodeURIComponent(
    config.username
  )}:${encodeURIComponent(config.password)}@${host}:${
    config.port
  }/${encodeURIComponent(config.database)}?sslmode=${config.sslMode}`
}
function serviceFile(config) {
  return (
    '[slipway]\n' +
    Object.entries({
      host: config.host,
      port: config.port,
      dbname: config.database,
      user: config.username,
      sslmode: config.sslMode,
      connect_timeout: 10,
      ...(config.sslMode === 'verify-full'
        ? {
            sslrootcert: config.caCertificate
              ? '/run/slipway/ca.pem'
              : '/etc/ssl/certs/ca-certificates.crt'
          }
        : {})
    })
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') +
    '\n'
  )
}
function normalize(error) {
  const text = String(error?.stderr || error?.message || '')
  let code = error?.name === 'AbortError' ? 'STREAM_ABORTED' : error?.code
  if (code === 'PROCESS_TIMEOUT') code = 'STREAM_TIMEOUT'
  if (code === 'ABORT_ERR') code = 'STREAM_ABORTED'
  if (/statement timeout|lock timeout/i.test(text)) code = 'STREAM_TIMEOUT'
  if (code === 'PROCESS_ABORTED') code = 'STREAM_ABORTED'
  if (
    ![
      'STREAM_TIMEOUT',
      'STREAM_SIZE_LIMIT',
      'STREAM_ABORTED',
      'EXTERNAL_CONFIGURATION',
      'EXTERNAL_DNS',
      'EXTERNAL_TCP',
      'EXTERNAL_TLS',
      'EXTERNAL_AUTHENTICATION',
      'EXTERNAL_PERMISSION',
      'EXTERNAL_VERSION',
      'EXTERNAL_CLIENT',
      'EXTERNAL_CLEANUP'
    ].includes(code)
  )
    code =
      /could not translate host name|Name or service not known|name resolution/i.test(
        text
      )
        ? 'EXTERNAL_DNS'
        : /certificate|SSL|TLS|root certificate/i.test(text)
        ? 'EXTERNAL_TLS'
        : /password authentication|authentication failed|no password supplied|pg_hba/i.test(
            text
          )
        ? 'EXTERNAL_AUTHENTICATION'
        : /permission denied|row-level security|must be owner|insufficient_privilege/i.test(
            text
          )
        ? 'EXTERNAL_PERMISSION'
        : /server version.*pg_dump|server version mismatch/i.test(text)
        ? 'EXTERNAL_VERSION'
        : /connection refused|timeout expired|No route|could not connect|connection timed out/i.test(
            text
          )
        ? 'EXTERNAL_TCP'
        : 'EXTERNAL_CLIENT'
  const messages = {
    EXTERNAL_DNS: 'The database hostname could not be resolved from Slipway.',
    EXTERNAL_TCP:
      'Slipway could not reach the database. Check the address, port and firewall allowlist.',
    EXTERNAL_TLS:
      'TLS verification failed. Check the database certificate, hostname and CA.',
    EXTERNAL_AUTHENTICATION:
      'The database rejected authentication. Check credentials and server access rules.',
    EXTERNAL_PERMISSION:
      'The database role cannot read everything required for a logical backup. Check table, sequence and row-security permissions.',
    EXTERNAL_VERSION:
      'This integration supports PostgreSQL servers 14 through 17.',
    EXTERNAL_CLEANUP:
      'External client cleanup could not be confirmed. Check Docker and retry verification.',
    EXTERNAL_CLIENT:
      'The isolated PostgreSQL client could not complete the operation. Check Docker availability and database access.',
    STREAM_TIMEOUT: 'The database operation exceeded its deadline.',
    STREAM_SIZE_LIMIT: 'The database dump exceeds the backup size limit.',
    STREAM_ABORTED: 'The database operation was cancelled.',
    EXTERNAL_CONFIGURATION: 'The external database configuration is invalid.'
  }
  const result = new Error(messages[code])
  result.code = code
  return result
}
function passwordFile(config) {
  const escape = (value) =>
    String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:')
  return (
    [
      config.host,
      config.port,
      config.database,
      config.username,
      config.password
    ]
      .map(escape)
      .join(':') + '\n'
  )
}
const hidden = '[Managed external connection]'
function redactEnv(values, services) {
  const result = { ...values }
  for (const service of services || [])
    if (
      service.managementMode === 'external' &&
      service.envVarKey &&
      Object.hasOwn(result, service.envVarKey)
    )
      result[service.envVarKey] = hidden
  return result
}
module.exports = {
  parse,
  connectionUrl,
  serviceFile,
  passwordFile,
  normalize,
  redactEnv,
  hidden
}
