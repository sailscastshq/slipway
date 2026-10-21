const { randomUUID } = require('node:crypto')
const transaction = require('./with-datastore-transaction')
const owners = require('./service-provisioning-owner')
const artifacts = require('./service-provisioning-docker')
const types = ['postgresql', 'mysql', 'mongodb', 'redis']
const operation = (s) => s.imageMetadata?.provisioning
const fingerprint = (s) => JSON.stringify([s.status, s.updatedAt, operation(s)])
const conflict = (message) =>
  Object.assign(new Error(message), { code: 'PROVISIONING_CONFLICT' })

async function eligibility(service, self = null) {
  if (
    service.managementMode === 'external' ||
    !types.includes(service.type) ||
    !['creating', 'failed'].includes(service.status)
  )
    return { eligible: false }
  try {
    self ||= await owners.current()
    const prior = operation(service)
    const eligible = prior
      ? prior.version === 1 &&
        ['running', 'failed'].includes(prior.state) &&
        (prior.state === 'failed' || (await owners.dead(prior.owner, self)))
      : service.status === 'creating' && owners.legacyInterrupted(service, self)
    return { eligible: Boolean(eligible) }
  } catch {
    return { eligible: false }
  }
}
async function claim(service, retry, actor) {
  const self = await owners.current()
  if (retry && !(await eligibility(service, self)).eligible)
    throw conflict(
      'The previous provisioner is active or cannot be proved stopped. Preserve the service and inspect the host.'
    )
  return transaction(async (db) => {
    const live = await Service.findOne({ id: service.id }).usingConnection(db)
    if (
      !live ||
      fingerprint(live) !== fingerprint(service) ||
      (!retry && (operation(live) || live.status !== 'creating'))
    )
      throw conflict(
        'Another service operation started. Refresh before retrying.'
      )
    const environment = await Environment.findOne({
      id: live.environment
    }).usingConnection(db)
    if (!environment)
      throw conflict('The service environment no longer exists.')
    const cleanup = await CleanupOperation.findOne({
      status: { nin: ['complete'] },
      or: [
        { scopeType: 'service', serviceId: live.id },
        { scopeType: 'environment', environmentId: live.environment },
        { scopeType: 'project', projectId: environment.project }
      ]
    }).usingConnection(db)
    if (cleanup)
      throw conflict(
        'Cleanup is pending. Preserve the service and finish inspecting it first.'
      )
    const token = randomUUID()
    await Service.updateOne({ id: live.id })
      .set({
        status: 'creating',
        imageMetadata: {
          ...(live.imageMetadata || {}),
          provisioning: {
            version: 1,
            token,
            owner: self,
            state: 'running',
            startedAt: Date.now(),
            retry,
            actor
          }
        }
      })
      .usingConnection(db)
    return token
  })
}
async function owned(id, token, db) {
  let query = Service.findOne({ id })
  if (db) query = query.usingConnection(db)
  const service = await query
  if (
    !service ||
    operation(service)?.token !== token ||
    operation(service).state !== 'running'
  )
    throw conflict(
      'Provisioning ownership changed. Preserve existing artifacts.'
    )
  return service
}
async function finish(id, token, result) {
  const connectionUrl = await Service.getConnectionUrl(id)
  return transaction(async (db) => {
    const service = await owned(id, token, db)
    const actor = operation(service).actor || {}
    const env = await Environment.findOne({ id: service.environment })
      .decrypt()
      .usingConnection(db)
    if (!env) throw conflict('The environment no longer exists.')
    const vars = { ...(env.envVars || {}) }
    const before = { ...vars }
    const metadata = { ...(env.envVarMetadata || {}) }
    let key = service.envVarKey || Service.getDefaultEnvVarKey(service.type)
    if (
      key &&
      !service.envVarKey &&
      vars[key] !== undefined &&
      vars[key] !== connectionUrl
    )
      key = `${service.name.replace(/-/g, '_').toUpperCase()}_URL`
    if (key && vars[key] !== undefined && vars[key] !== connectionUrl)
      throw conflict(
        'The managed connection variable is occupied. Preserve it and inspect the configuration.'
      )
    if (key) {
      vars[key] = connectionUrl
      metadata[key] = {
        kind: 'secret',
        redaction: 'credential',
        managed: true,
        previewPolicy: 'omit',
        description: `Connection URL managed by ${service.name}`
      }
    }
    const normalized = sails.helpers.configuration.normalizeEnvVarMetadata.with(
      {
        values: vars,
        metadata,
        currentValues: before,
        currentMetadata: env.envVarMetadata || {},
        managedKeys: key ? [key] : [],
        changedBy: actor.userId,
        changedByName: actor.userName
      }
    )
    await Environment.updateOne({ id: env.id })
      .set({ envVars: vars, envVarMetadata: normalized })
      .usingConnection(db)
    const changes = sails.helpers.configuration.diffEnvVars(
      before,
      vars,
      env.envVarMetadata || {},
      normalized
    )
    for (const change of changes)
      await AuditLog.create({
        action: `configuration.${change.operation}`,
        resourceType: 'environment',
        resourceId: String(env.id),
        user: actor.userId || null,
        team: actor.teamId || null,
        ipAddress: actor.ipAddress || null,
        details: { scope: 'environment', ...change }
      }).usingConnection(db)
    await AuditLog.create({
      action: operation(service).retry
        ? 'service.provisioning.recovered'
        : 'service.created',
      resourceType: 'service',
      resourceId: String(id),
      user: actor.userId || null,
      team: actor.teamId || null,
      ipAddress: actor.ipAddress || null,
      details: { name: service.name, type: service.type, operationToken: token }
    }).usingConnection(db)
    await Service.updateOne({ id })
      .set({
        containerId: result.containerId,
        envVarKey: key,
        status: 'running',
        imageMetadata: {
          ...(service.imageMetadata || {}),
          volumeName: result.volumeName,
          provisioning: {
            ...operation(service),
            state: 'completed',
            completedAt: Date.now()
          }
        }
      })
      .usingConnection(db)
    sails.hooks.secrets?.remember({ envVars: vars, envVarMetadata: normalized })
    return { serviceId: id, status: 'running' }
  })
}
async function provision({ serviceId, retry = false, actor = {} }) {
  const service = await Service.findOne({ id: serviceId })
  if (
    !service ||
    !types.includes(service.type) ||
    service.managementMode === 'external'
  )
    throw conflict('Only managed database services can retry provisioning.')
  const token = await claim(service, retry, actor)
  try {
    const decrypted = await Service.findOne({ id: serviceId }).decrypt()
    sails.hooks.secrets?.remember(decrypted)
    let result = retry ? await artifacts.reconcile(decrypted) : null
    await owned(serviceId, token)
    if (!result)
      result = await sails.helpers.docker.createService.with({
        serviceId: String(serviceId),
        deferRunning: true
      })
    await sails.helpers.docker.waitForService.with({
      service: decrypted,
      containerName: decrypted.containerName
    })
    await owned(serviceId, token)
    await artifacts.verifyCredentials(decrypted)
    return await finish(serviceId, token, result)
  } catch (error) {
    await transaction(async (db) => {
      const live = await owned(serviceId, token, db)
      const actor = operation(live).actor || {}
      await AuditLog.create({
        action: 'service.provisioning.failed',
        resourceType: 'service',
        resourceId: String(serviceId),
        user: actor.userId || null,
        team: actor.teamId || null,
        ipAddress: actor.ipAddress || null,
        details: { operationToken: token, artifactsPreserved: true }
      }).usingConnection(db)
      await Service.updateOne({ id: serviceId })
        .set({
          status: 'failed',
          imageMetadata: {
            ...(live.imageMetadata || {}),
            provisioning: {
              ...operation(live),
              state: 'failed',
              completedAt: Date.now()
            }
          }
        })
        .usingConnection(db)
    })
    // Child command errors can contain credentials. Return a fixed safe error.
    if (error.code === 'PROVISIONING_CONFLICT') throw error
    throw new Error(
      'Provisioning did not complete. Existing artifacts and credentials were preserved; inspect service logs before retrying.'
    )
  }
}
module.exports = {
  eligibility,
  provision,
  _private: { claim, owned, finish, fingerprint }
}
