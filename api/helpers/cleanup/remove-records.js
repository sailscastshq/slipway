module.exports = {
  friendlyName: 'Remove cleanup records',

  description:
    'Delete a cleanup snapshot’s database records in an idempotent order.',

  inputs: {
    snapshot: {
      type: 'ref',
      required: true
    },
    operationId: {
      type: 'number',
      description:
        'Durable operation whose snapshot receives final recovery references.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ snapshot, operationId }) {
    const { records, services, target } = snapshot
    const removed = {
      observability: await removeObservabilityRecords(snapshot),
      default: {}
    }
    // Analytics cleanup is independent and idempotent. A storage failure leaves
    // the cleanup operation retryable rather than claiming history was removed.
    if (records.appIds?.length) {
      if (!sails.wakeStorageReady) await sails.helpers.wake.ensureSchema()
      for (const appId of records.appIds)
        require('../../lib/wake-store').deleteApp(String(appId))
    }
    const customServices = (services || []).filter(
      (service) => service.type === 'custom'
    )
    const environmentVars = await getEnvironmentVarUpdates(services)

    await sails.getDatastore().transaction(async (db) => {
      removed.default.recoverySettings = await retireRecovery(
        snapshot,
        operationId,
        db
      )
      for (const service of customServices)
        await require('../../lib/custom-service').links(
          { ...service, environment: service.environmentId },
          [],
          db
        )
      for (const update of environmentVars) {
        await Environment.updateOne({ id: update.environmentId })
          .set({
            envVars: update.envVars,
            envVarMetadata: update.envVarMetadata
          })
          .usingConnection(db)
      }

      if (target.scopeType === 'app') {
        removed.default.featureFlags = await destroyCriteriaCount(
          FeatureFlag,
          { app: { in: records.appIds } },
          db
        )
        removed.default.bridgeLaunchCodes = await destroyCriteriaCount(
          BridgeLaunchCode,
          { app: { in: records.appIds } },
          db
        )
        removed.default.bridgeAccess = await destroyCriteriaCount(
          BridgeAccess,
          { app: { in: records.appIds } },
          db
        )
        removed.default.repositories = await destroyCount(
          GitRepository,
          records.repositoryIds,
          db
        )
        removed.default.deploymentsDetached = await updateCount(
          Deployment,
          records.deploymentIds,
          { app: null },
          db
        )
        removed.default.apps = await destroyCount(App, records.appIds, db)
        return
      }

      if (target.scopeType === 'service') {
        removed.default.backups = await destroyCount(
          Backup,
          records.backupIds,
          db
        )
        removed.default.services = await destroyCount(
          Service,
          records.serviceIds,
          db
        )
        return
      }

      await updateCount(App, records.appIds, { currentDeployment: null }, db)
      removed.default.featureFlags = await destroyCriteriaCount(
        FeatureFlag,
        { app: { in: records.appIds } },
        db
      )
      removed.default.bridgeLaunchCodes = await destroyCriteriaCount(
        BridgeLaunchCode,
        { app: { in: records.appIds } },
        db
      )
      removed.default.bridgeAccess = await destroyCriteriaCount(
        BridgeAccess,
        { app: { in: records.appIds } },
        db
      )
      removed.default.deploymentLeases = await destroyCount(
        DeploymentLease,
        records.deploymentLeaseIds,
        db
      )
      removed.default.deploymentJobs = await destroyCount(
        DeploymentJob,
        records.deploymentJobIds,
        db
      )
      removed.default.repositories = await destroyCount(
        GitRepository,
        records.repositoryIds,
        db
      )
      removed.default.backups = await destroyCount(
        Backup,
        records.backupIds,
        db
      )
      removed.default.deployTokens = await destroyCount(
        DeployToken,
        records.deployTokenIds,
        db
      )
      removed.default.deployments = await destroyCount(
        Deployment,
        records.deploymentIds,
        db
      )
      removed.default.apps = await destroyCount(App, records.appIds, db)
      removed.default.services = await destroyCount(
        Service,
        records.serviceIds,
        db
      )
      removed.default.environments = await destroyCount(
        Environment,
        records.environmentIds,
        db
      )
      removed.default.projects = await destroyCount(
        Project,
        records.projectIds,
        db
      )
    })

    return removed
  }
}

async function retireRecovery(snapshot, operationId, db) {
  const { appIds = [], deploymentIds = [] } = snapshot.records
  if (!appIds.length) return 0
  const apps = await App.find({ id: { in: appIds } }).usingConnection(db)
  const captured =
    await require('../../lib/cleanup-deployment-recovery').capture({
      apps,
      appIds,
      deploymentIds,
      db
    })
  const retained = snapshot.artifacts?.recoveryImageIds || []
  const { IMAGE_ID } = require('../../lib/deployment-recovery')
  if (!Array.isArray(retained) || retained.some((id) => !IMAGE_ID.test(id)))
    throw new Error('Deletion snapshot recovery image references are invalid.')
  const refreshed = {
    ...snapshot,
    records: { ...snapshot.records, recoverySettingKeys: captured.settingKeys },
    artifacts: {
      ...snapshot.artifacts,
      recoveryImageIds: [...new Set([...retained, ...captured.imageIds])]
    }
  }
  if (operationId) {
    const operation = await CleanupOperation.findOne({
      id: operationId
    }).usingConnection(db)
    const sameIds = (a = [], b = []) =>
      JSON.stringify(a.map(String).sort()) ===
      JSON.stringify(b.map(String).sort())
    if (
      !operation ||
      operation.snapshot.target.scopeType !== snapshot.target.scopeType ||
      !sameIds(operation.snapshot.records.appIds, appIds) ||
      !sameIds(operation.snapshot.records.deploymentIds, deploymentIds)
    )
      throw new Error(
        'The durable deletion snapshot no longer matches its scope.'
      )
    await CleanupOperation.updateOne({ id: operationId })
      .set({ snapshot: refreshed })
      .usingConnection(db)
  } else if (captured.imageIds.some((id) => !retained.includes(id))) {
    throw new Error(
      'Persist recovery image references before deleting their settings.'
    )
  }
  if (!captured.settingKeys.length) return 0
  return destroyCriteriaCount(
    Setting,
    { key: { in: captured.settingKeys } },
    db
  )
}

async function getEnvironmentVarUpdates(services) {
  const keysByEnvironment = new Map()

  for (const service of services || []) {
    if (!service.envVarKey) continue
    const keys = keysByEnvironment.get(service.environmentId) || new Set()
    keys.add(service.envVarKey)
    if (service.managementMode === 'external')
      keys.add(`${service.envVarKey}_CA_CERT`)
    keysByEnvironment.set(service.environmentId, keys)
  }

  const updates = []
  for (const [environmentId, keys] of keysByEnvironment) {
    const environment = await Environment.findOne({
      id: environmentId
    }).decrypt()
    if (!environment) continue

    const envVars = { ...(environment.envVars || {}) }
    const envVarMetadata = { ...(environment.envVarMetadata || {}) }
    for (const key of keys) {
      delete envVars[key]
      delete envVarMetadata[key]
    }
    updates.push({ environmentId, envVars, envVarMetadata })
  }

  return updates
}

async function removeObservabilityRecords(snapshot) {
  const { records, target } = snapshot
  const removed = {}

  if (target.scopeType === 'project' || target.scopeType === 'environment') {
    const environmentNumbers = records.environmentIds.map(Number)
    const environmentStrings = records.environmentIds.map(String)
    removed.appLogs = await destroyByCriteria(AppLog, {
      environment: { in: environmentStrings }
    })
    removed.containerMetrics = await destroyByCriteria(ContainerMetric, {
      environment: { in: environmentNumbers }
    })
    removed.telemetryIngestionBudgets = await destroyByCriteria(
      TelemetryIngestionBudget,
      { environment: { in: environmentStrings } }
    )
    removed.telemetrySpans = await destroyByCriteria(TelemetrySpan, {
      environment: { in: environmentStrings }
    })
    removed.telemetryExceptions = await destroyByCriteria(TelemetryException, {
      environment: { in: environmentStrings }
    })
    removed.telemetryMetrics = await destroyByCriteria(TelemetryMetric, {
      environment: { in: environmentStrings }
    })
    return removed
  }

  if (target.scopeType === 'app') {
    removed.appLogs = await destroyByCriteria(AppLog, {
      app: { in: records.appIds.map(String) }
    })
    removed.containerMetrics = await destroyByCriteria(ContainerMetric, {
      app: { in: records.appIds.map(Number) }
    })
    return removed
  }

  removed.containerMetrics = await destroyByCriteria(ContainerMetric, {
    service: { in: records.serviceIds.map(Number) }
  })
  return removed
}

async function destroyByCriteria(model, criteria) {
  const values = Object.values(criteria)
  if (
    values.some(
      (value) => value && Array.isArray(value.in) && value.in.length === 0
    )
  ) {
    return 0
  }
  const destroyed = await model.destroy(criteria).fetch()
  return destroyed.length
}

async function destroyCount(model, ids, db) {
  if (!ids || ids.length === 0) return 0
  const destroyed = await model
    .destroy({ id: { in: ids } })
    .fetch()
    .usingConnection(db)
  return destroyed.length
}

async function destroyCriteriaCount(model, criteria, db) {
  if (
    Object.values(criteria).some(
      (value) => value && Array.isArray(value.in) && value.in.length === 0
    )
  ) {
    return 0
  }
  const destroyed = await model.destroy(criteria).fetch().usingConnection(db)
  return destroyed.length
}

async function updateCount(model, ids, values, db) {
  if (!ids || ids.length === 0) return 0
  const updated = await model
    .update({ id: { in: ids } })
    .set(values)
    .fetch()
    .usingConnection(db)
  return updated.length
}
