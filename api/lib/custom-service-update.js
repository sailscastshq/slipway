const crypto = require('node:crypto')
const custom = require('./custom-service')
const transaction = require('./with-datastore-transaction')
const active = new Set()
const fingerprint = (service) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        service.containerId,
        service.imageReference,
        service.customDefinition,
        service.customState,
        service.publicRoute?.version
      ])
    )
    .digest('hex')
function available(service) {
  if (
    service.customState?.update ||
    service.publicRoute?.operation ||
    ['creating', 'changing', 'upgrading', 'restoring'].includes(service.status)
  )
    custom.fail('Finish or recover the current service operation first.')
  if (
    service.customState?.volumes?.length ||
    service.customDefinition?.volumes?.length
  )
    custom.fail(
      'Automated updates are unavailable for services with persistent data. An application-consistent recovery method is required.'
    )
}
function snapshot(service, containerName) {
  return {
    containerName,
    containerId: service.containerId,
    imageReference: service.imageReference,
    imageMetadata: service.imageMetadata,
    version: service.version,
    customDefinition: service.customDefinition,
    resourceLimits: service.resourceLimits,
    customState: service.customState
  }
}
async function review(service, actor, changes = {}, revert = false) {
  available(service)
  if (service.status !== 'running')
    custom.fail('Start the service before reviewing an update.')
  if (!changes || typeof changes !== 'object' || Array.isArray(changes))
    custom.fail('Enter configuration changes.')
  const allowed = [
    'image',
    'env',
    'command',
    'healthCommand',
    'cpus',
    'memoryMiB'
  ]
  if (Object.keys(changes).some((key) => !allowed.includes(key)))
    custom.fail(
      'Updates preserve the service name, port, data paths and app connections.'
    )
  let definition, image
  if (revert) {
    const previous = service.customRecovery?.previous
    if (!previous) custom.fail('There is no retained image to revert to.')
    definition = previous.customDefinition
    image = JSON.parse(
      (await custom.command(['image', 'inspect', previous.imageReference]))
        .stdout
    )[0]
    if (image.Id !== previous.imageReference)
      custom.fail('The retained image is unavailable.')
  } else {
    definition = { ...service.customDefinition, ...changes }
    custom.validate(definition)
    image = await custom.inspectImage(definition.image)
  }
  definition = custom.validate(
    { ...definition, appIds: service.customState.appIds || [] },
    image.Config
  )
  if (definition.volumes.length)
    custom.fail(
      'The candidate declares persistent data. Automated updates are unavailable.'
    )
  if (
    !definition.healthCommand.length &&
    (!image.Config.Healthcheck?.Test?.length ||
      image.Config.Healthcheck.Test[0] === 'NONE')
  )
    custom.fail(
      'Add a health check that verifies the service is ready before updating.'
    )
  const current = await custom.inspectContainer(service)
  if (!current?.State.Running || current.Id !== service.containerId)
    custom.fail(
      'The active container changed. Refresh its status and review again.'
    )
  if (current.Mounts?.length)
    custom.fail(
      'The running service has mounted data. Automated updates are unavailable.'
    )
  if (
    (await CustomServiceReview.count({
      actor: actor.user.id,
      expiresAt: { '>': Date.now() }
    })) >= 20
  )
    custom.fail(
      'Too many active reviews. Wait for an earlier review to expire.'
    )
  const item = await CustomServiceReview.create({
    token: crypto.randomUUID(),
    actor: actor.user.id,
    environment: service.environment,
    serviceId: service.id,
    definition: {
      configuration: definition,
      fingerprint: fingerprint(service)
    },
    imageReference: image.Id,
    imageMetadata: { purpose: 'service-update', revert },
    expiresAt: Date.now() + 600000
  }).fetch()
  return {
    id: item.token,
    imageReference: image.Id,
    before: custom.publicDefinition(service.customDefinition),
    after: custom.publicDefinition(definition),
    changed: allowed.filter(
      (key) =>
        JSON.stringify(service.customDefinition[key]) !==
        JSON.stringify(definition[key])
    ),
    revert,
    expiresAt: item.expiresAt
  }
}
async function inspect(service, name, expectedId) {
  const container = await custom.inspectContainer({
    ...service,
    containerName: name
  })
  if (container && expectedId && container.Id !== expectedId)
    custom.fail('A recovery container changed identity. It was left unchanged.')
  return container
}
async function healthy(service, name, expectedId) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const container = await inspect(service, name, expectedId)
    if (
      !container?.State.Running ||
      container.State.Health?.Status === 'unhealthy'
    )
      custom.fail('The candidate did not pass its health check.')
    if (container.State.Health?.Status === 'healthy') return container
    if (!container.State.Health)
      custom.fail('A verified health check is required.')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  custom.fail('The candidate did not become healthy within 30 seconds.')
}
async function audit(service, actor, action, details, db) {
  await AuditLog.create({
    action,
    resourceType: 'service',
    resourceId: String(service.id),
    user: actor.user.id,
    team: actor.project.team,
    details
  }).usingConnection(db)
}
async function reconnect(service, name) {
  const network = sails.config.custom.slipwayNetwork || 'slipway'
  const container = await inspect(service, name)
  if (container?.NetworkSettings?.Networks?.[network])
    await custom.command(['network', 'disconnect', network, name])
  await custom.command([
    'network',
    'connect',
    '--alias',
    service.internalHost,
    network,
    name
  ])
}
async function recoverRuntime(service, operation) {
  const canonical = service.containerName
  const previous = await inspect(
    service,
    operation.previousName,
    operation.previousId
  )
  const current = await inspect(service, canonical)
  if (previous) {
    if (current) {
      if (current.Id !== operation.candidateId)
        custom.fail('The active container changed. Recovery was stopped.')
      await custom.command(['rm', '-f', canonical])
    }
    await custom.command(['rename', operation.previousName, canonical])
  } else if (!current || current.Id !== operation.previousId)
    custom.fail(
      'The previous container is unavailable. Recovery needs attention.'
    )
  const candidate = await inspect(
    service,
    operation.candidateName,
    operation.candidateId
  )
  if (candidate) await custom.command(['rm', '-f', operation.candidateName])
  await reconnect(service, canonical)
  await custom.command(['start', canonical])
  const restored = await inspect(service, canonical, operation.previousId)
  if (!restored?.State.Running)
    custom.fail('The previous container could not be restarted.')
  return restored
}
async function recoverSaved(service, actor) {
  const operation = service.customState.update
  const previous = service.customRecovery?.pending
  if (!operation || !previous)
    custom.fail('No recoverable update is available.')
  await recoverRuntime(service, operation)
  await transaction(async (db) => {
    const { containerName, ...fields } = previous
    await Service.updateOne({ id: service.id })
      .set({
        ...fields,
        status: 'running',
        customRecovery: { previous: service.customRecovery.previous || null },
        customState: {
          ...previous.customState,
          error:
            'The previous image and configuration were restored. Review again to retry.'
        }
      })
      .usingConnection(db)
    await audit(
      service,
      actor,
      'service.custom.update.recovered',
      { imageReference: previous.imageReference },
      db
    )
  })
}
async function apply(item, actor) {
  const id = String(item.serviceId)
  if (active.has(id)) custom.fail('A service update is already running.')
  active.add(id)
  try {
    let service = await Service.findOne({ id }).decrypt()
    if (item.imageMetadata.completed) return service
    available(service)
    if (
      item.expiresAt <= Date.now() ||
      item.definition?.fingerprint !== fingerprint(service)
    )
      custom.fail('The review is stale. Review the update again.')
    const definition = custom.validate(item.definition.configuration)
    const old = await inspect(
      service,
      service.containerName,
      service.containerId
    )
    if (!old?.State.Running || old.Mounts?.length)
      custom.fail(
        'The active service changed or has mounted data. Review again.'
      )
    const image = JSON.parse(
      (await custom.command(['image', 'inspect', item.imageReference])).stdout
    )[0]
    if (
      image.Id !== item.imageReference ||
      Object.keys(image.Config.Volumes || {}).length
    )
      custom.fail('The reviewed stateless image is unavailable.')
    const suffix = crypto.randomUUID()
    const operation = {
      id: suffix,
      candidateName: `${service.containerName}-candidate-${suffix}`,
      previousName: `${service.containerName}-previous-${suffix}`,
      previousId: old.Id,
      candidateId: null
    }
    await transaction(async (db) => {
      await custom.available(
        service.environment,
        actor.project.id,
        service.id,
        db
      )
      const current = await Service.findOne({ id })
        .decrypt()
        .usingConnection(db)
      available(current)
      const currentReview = await CustomServiceReview.findOne({
        id: item.id
      }).usingConnection(db)
      if (
        fingerprint(current) !== item.definition.fingerprint ||
        currentReview.imageMetadata.consumed ||
        currentReview.expiresAt <= Date.now()
      )
        custom.fail('The service or review changed. Review again.')
      await Service.updateOne({ id })
        .set({
          status: 'changing',
          customState: {
            ...service.customState,
            update: operation,
            error: null
          },
          customRecovery: {
            previous: service.customRecovery?.previous || null,
            pending: snapshot(service, service.containerName)
          }
        })
        .usingConnection(db)
      await CustomServiceReview.updateOne({ id: item.id })
        .set({ imageMetadata: { ...item.imageMetadata, consumed: true } })
        .usingConnection(db)
      await audit(
        service,
        actor,
        'service.custom.update.requested',
        {
          imageReference: item.imageReference,
          envKeys: Object.keys(definition.env)
        },
        db
      )
    })
    try {
      await custom.createContainer(
        {
          ...service,
          containerName: operation.candidateName,
          imageReference: item.imageReference,
          customState: { volumes: [] }
        },
        definition
      )
      const candidate = await inspect(service, operation.candidateName)
      operation.candidateId = candidate.Id
      await Service.updateOne({ id }).set({
        customState: { ...service.customState, update: operation, error: null }
      })
      await custom.command(['start', operation.candidateName])
      await healthy(service, operation.candidateName, candidate.Id)
      await inspect(service, service.containerName, operation.previousId)
      await custom.command(['stop', service.containerName])
      const network = sails.config.custom.slipwayNetwork || 'slipway'
      await custom.command([
        'network',
        'disconnect',
        network,
        service.containerName
      ])
      await custom.command([
        'rename',
        service.containerName,
        operation.previousName
      ])
      await custom.command([
        'rename',
        operation.candidateName,
        service.containerName
      ])
      await reconnect(service, service.containerName)
      const running = await healthy(
        service,
        service.containerName,
        candidate.Id
      )
      await transaction(async (db) => {
        await Service.updateOne({ id })
          .set({
            status: 'running',
            containerId: running.Id,
            imageReference: item.imageReference,
            version: definition.image,
            customDefinition: definition,
            imageMetadata: { source: 'custom-update', reviewId: item.token },
            resourceLimits: {
              cpus: String(definition.cpus),
              memory: `${definition.memoryMiB}m`
            },
            customRecovery: {
              previous: snapshot(service, operation.previousName)
            },
            customState: {
              ...service.customState,
              image: definition.image,
              health: 'healthy',
              observedAt: Date.now(),
              error: null,
              previousImage: service.version,
              retainedContainers: [
                ...(service.customState.retainedContainers || []),
                operation.previousName
              ]
            }
          })
          .usingConnection(db)
        await CustomServiceReview.updateOne({ id: item.id })
          .set({
            definition: {},
            imageMetadata: { ...item.imageMetadata, completed: true }
          })
          .usingConnection(db)
        await audit(
          service,
          actor,
          item.imageMetadata.revert
            ? 'service.custom.image.reverted'
            : 'service.custom.updated',
          { imageReference: item.imageReference },
          db
        )
      })
    } catch (error) {
      service = await Service.findOne({ id }).decrypt()
      await recoverSaved(service, actor).catch(async () => {
        await Service.updateOne({ id }).set({
          status: 'failed',
          customState: {
            ...service.customState,
            error:
              'The update could not finish. Recover the previous image before another operation.'
          }
        })
      })
      custom.fail(
        'The update failed. Refresh to check recovery before retrying.'
      )
    }
    return Service.findOne({ id })
  } finally {
    active.delete(id)
  }
}
async function recover(service, actor) {
  const id = String(service.id)
  if (active.has(id) || service.status === 'changing')
    custom.fail('Wait for the active update to finish.')
  if (!service.customState?.update)
    custom.fail('No interrupted update is available.')
  const claimed = await Service.updateOne({ id, status: service.status }).set({
    status: 'changing'
  })
  if (!claimed) custom.fail('Another service operation started.')
  active.add(id)
  try {
    await recoverSaved(service, actor)
    return Service.findOne({ id })
  } catch (error) {
    await Service.updateOne({ id }).set({ status: 'failed' })
    throw error
  } finally {
    active.delete(id)
  }
}
module.exports = { review, apply, recover, fingerprint }
