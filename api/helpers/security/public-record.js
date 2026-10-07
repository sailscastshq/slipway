const fields = {
  app: [
    'id',
    'name',
    'slug',
    'status',
    'dockerfilePath',
    'routePath',
    'isDefault',
    'containerId',
    'containerName',
    'imageId',
    'imageName',
    'port',
    'hostPort',
    'lastDeployedAt',
    'resourceLimits',
    'environment',
    'currentDeployment',
    'healthPath',
    'bridgeEnabled',
    'bearingEnabled',
    'wakeEnabled',
    'wakeSettings',
    'createdAt',
    'updatedAt',
    'containerHealth',
    'directAccess',
    'primaryUrl',
    'accessUrls',
    'bridgeUrl'
  ],
  environment: [
    'id',
    'name',
    'slug',
    'isProduction',
    'domain',
    'project',
    'features',
    'envVarMetadata',
    'createdAt',
    'updatedAt'
  ],
  service: [
    'id',
    'name',
    'type',
    'managementMode',
    'version',
    'versionSupport',
    'imageReference',
    'imageMetadata',
    'upgradeState',
    'status',
    'containerId',
    'containerName',
    'internalHost',
    'internalPort',
    'database',
    'username',
    'envVarKey',
    'resourceLimits',
    'environment',
    'publicRoute',
    'customState',
    'externalVerification',
    'createdAt',
    'updatedAt'
  ],
  deployment: [
    'id',
    'status',
    'gitCommit',
    'gitMessage',
    'gitBranch',
    'sourceRevision',
    'configHash',
    'configManifest',
    'triggerType',
    'imageName',
    'imageId',
    'containerId',
    'buildLogs',
    'deployLogs',
    'errorMessage',
    'startedAt',
    'finishedAt',
    'createdAt',
    'updatedAt',
    'environment',
    'app',
    'triggeredBy',
    'sourceType',
    'sourceReference',
    'sourceMetadata',
    'sourceSnapshot',
    'duration',
    'queuePosition',
    'appId',
    'isCurrent',
    'isCurrentDeployment',
    'outcome',
    'outcomeLabel',
    'retryable',
    'healthStatus',
    'healthMessage'
  ]
}
module.exports = {
  friendlyName: 'Present public record',
  description:
    'Explicitly allowlist deployment metadata without encrypted fields.',
  sync: true,
  inputs: {
    kind: { type: 'string', required: true, isIn: Object.keys(fields) },
    record: { type: 'ref', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: function ({ kind, record }) {
    return present(kind, record)
  }
}
function present(kind, record) {
  if (!record) return null
  const result = Object.fromEntries(
    fields[kind]
      .filter((key) => Object.hasOwn(record, key))
      .map((key) => [key, record[key]])
  )
  if (kind === 'environment') {
    for (const [key, type] of [
      ['app', 'app'],
      ['services', 'service'],
      ['deployments', 'deployment']
    ]) {
      if (Array.isArray(record[key]))
        result[key] = record[key].map((value) => present(type, value))
    }
  }
  for (const [key, type] of [
    ['environment', 'environment'],
    ['app', 'app']
  ]) {
    if (result[key] && typeof result[key] === 'object')
      result[key] = present(type, result[key])
  }
  return result
}
module.exports._private = { present }
