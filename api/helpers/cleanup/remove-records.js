module.exports = {
  friendlyName: 'Remove cleanup records',

  description:
    'Delete a cleanup snapshot’s database records in an idempotent order.',

  inputs: {
    snapshot: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ snapshot }) {
    const { records, services, target } = snapshot
    const removed = {
      observability: await removeObservabilityRecords(snapshot),
      default: {}
    }
    const environmentVars = await getEnvironmentVarUpdates(services)

    await sails.getDatastore().transaction(async (db) => {
      for (const update of environmentVars) {
        await Environment.updateOne({ id: update.environmentId })
          .set({ envVars: update.envVars })
          .usingConnection(db)
      }

      if (target.scopeType === 'app') {
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

async function getEnvironmentVarUpdates(services) {
  const keysByEnvironment = new Map()

  for (const service of services || []) {
    if (!service.envVarKey) continue
    const keys = keysByEnvironment.get(service.environmentId) || new Set()
    keys.add(service.envVarKey)
    keysByEnvironment.set(service.environmentId, keys)
  }

  const updates = []
  for (const [environmentId, keys] of keysByEnvironment) {
    const environment = await Environment.findOne({
      id: environmentId
    }).decrypt()
    if (!environment) continue

    const envVars = { ...(environment.envVars || {}) }
    for (const key of keys) {
      delete envVars[key]
    }
    updates.push({ environmentId, envVars })
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

async function updateCount(model, ids, values, db) {
  if (!ids || ids.length === 0) return 0
  const updated = await model
    .update({ id: { in: ids } })
    .set(values)
    .fetch()
    .usingConnection(db)
  return updated.length
}
