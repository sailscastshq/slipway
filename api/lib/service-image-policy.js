const SERVICE_IMAGE_POLICY = Object.freeze({
  postgresql: Object.freeze({
    label: 'PostgreSQL',
    repository: 'postgres',
    defaultVersion: '17',
    versions: Object.freeze([
      version('17', {
        recommended: true,
        upgradeFrom: ['16'],
        guidance:
          'Slipway takes a verified logical backup, restores it into a fresh PostgreSQL 17 volume, and keeps the previous container for recovery.'
      }),
      version('16')
    ])
  }),
  mysql: Object.freeze({
    label: 'MySQL',
    repository: 'mysql',
    defaultVersion: '8.4',
    versions: Object.freeze([
      version('8.4', {
        recommended: true,
        upgradeFrom: ['8.0'],
        guidance:
          'Slipway takes a verified logical backup, restores it into a fresh MySQL 8.4 volume, and keeps the previous container for recovery.'
      }),
      version('8.0')
    ])
  }),
  redis: Object.freeze({
    label: 'Redis',
    repository: 'redis',
    defaultVersion: '7.2',
    versions: Object.freeze([
      version('7.2', {
        recommended: true,
        guidance:
          'Slipway pins Redis 7.2. Automated Redis major upgrades remain disabled until a verified persistence backup can be guaranteed.'
      })
    ])
  }),
  mongodb: Object.freeze({
    label: 'MongoDB',
    repository: 'mongo',
    defaultVersion: '8.0',
    versions: Object.freeze([
      version('8.0', {
        recommended: true,
        upgradeFrom: ['7.0'],
        guidance:
          'Slipway takes a verified logical backup, restores it into a fresh MongoDB 8.0 volume, and keeps the previous container for recovery.'
      }),
      version('7.0')
    ])
  })
})

const SAFE_VERSION_PATTERN = /^\d+(?:\.\d+){0,2}$/

function version(value, options = {}) {
  return Object.freeze({
    version: value,
    recommended: options.recommended === true,
    upgradeFrom: Object.freeze(options.upgradeFrom || []),
    guidance: options.guidance || null
  })
}

function getPolicy(type) {
  return SERVICE_IMAGE_POLICY[type] || null
}

function getPublicMatrix() {
  return Object.fromEntries(
    Object.entries(SERVICE_IMAGE_POLICY).map(([type, policy]) => [
      type,
      {
        type,
        label: policy.label,
        repository: policy.repository,
        defaultVersion: policy.defaultVersion,
        versions: policy.versions.map((entry) => ({ ...entry }))
      }
    ])
  )
}

function inspectVersion(type, requestedVersion, { useDefault = true } = {}) {
  const policy = getPolicy(type)
  if (!policy) {
    throw policyError(`Unsupported service type: ${type}`)
  }

  const raw =
    requestedVersion === undefined || requestedVersion === null
      ? ''
      : String(requestedVersion).trim()
  const value = raw || (useDefault ? policy.defaultVersion : '')

  if (!value) {
    throw policyError('A service version is required.')
  }

  if (value.toLowerCase() === 'latest') {
    throw policyError(
      `The mutable "latest" tag is not allowed. Use ${policy.defaultVersion} for ${policy.label}.`
    )
  }

  if (!SAFE_VERSION_PATTERN.test(value)) {
    throw policyError(
      'Versions must be numeric Docker tags such as 17, 8.4, or 8.0.12.'
    )
  }

  const supportedEntry =
    policy.versions.find((entry) => entry.version === value) || null

  return {
    type,
    version: value,
    repository: policy.repository,
    imageTag: `${policy.repository}:${value}`,
    supported: Boolean(supportedEntry),
    recommended: supportedEntry?.recommended === true,
    defaultVersion: policy.defaultVersion,
    guidance: supportedEntry?.guidance || null
  }
}

function getUpgradePlan(type, fromVersion, toVersion) {
  const policy = getPolicy(type)
  if (!policy) {
    throw policyError(`Unsupported service type: ${type}`)
  }

  const source = inspectVersion(type, fromVersion, { useDefault: false })
  const target = inspectVersion(type, toVersion, { useDefault: false })
  const targetEntry = policy.versions.find(
    (entry) => entry.version === target.version
  )

  if (!source.supported) {
    throw policyError(
      `Slipway cannot automate an upgrade from unsupported ${policy.label} ${source.version}.`
    )
  }

  if (!targetEntry) {
    throw policyError(
      `${policy.label} ${target.version} is not in Slipway's tested upgrade matrix.`
    )
  }

  if (!targetEntry.upgradeFrom.includes(source.version)) {
    throw policyError(
      `Slipway does not support upgrading ${policy.label} ${source.version} to ${target.version}.`
    )
  }

  return {
    type,
    label: policy.label,
    fromVersion: source.version,
    toVersion: target.version,
    targetImageTag: target.imageTag,
    guidance: targetEntry.guidance,
    requiresBackup: true
  }
}

function findSupportedLine(type, detectedVersion) {
  const policy = getPolicy(type)
  if (!policy || !detectedVersion) return null

  const numeric = String(detectedVersion).match(/\d+(?:\.\d+){0,2}/)?.[0]
  if (!numeric) return null

  return (
    policy.versions.find(
      (entry) =>
        numeric === entry.version || numeric.startsWith(`${entry.version}.`)
    )?.version || numeric
  )
}

function policyError(message) {
  const error = new Error(message)
  error.code = 'INVALID_SERVICE_VERSION'
  return error
}

module.exports = {
  SAFE_VERSION_PATTERN,
  SERVICE_IMAGE_POLICY,
  findSupportedLine,
  getPolicy,
  getPublicMatrix,
  getUpgradePlan,
  inspectVersion
}
