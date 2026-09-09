const crypto = require('node:crypto')
const custom = require('./custom-service')
const claims = require('./domain-claims')
const transaction = require('./with-datastore-transaction')
const active = new Set()
const owner = (id) => `service:${id}`
const fingerprint = (service) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        service.id,
        service.containerName,
        service.containerId,
        service.imageReference,
        service.internalPort,
        service.publicRoute?.version || null
      ])
    )
    .digest('hex')

async function validateDomain(domain, service) {
  if (!domain) return
  const problems = sails.helpers.configuration.validate({ domain })
  if (problems.length)
    custom.fail('Enter a hostname without a scheme, port or path.')
  const instanceDomain = await sails.helpers.setting.get('instanceDomain')
  if (domain === String(instanceDomain || '').toLowerCase())
    custom.fail('This domain belongs to the Slipway dashboard.')
  for (const environment of await Environment.find()) {
    const { domains } = await Environment.resolveDomains(environment)
    if (domains.some((value) => value.toLowerCase() === domain))
      custom.fail(
        'This domain is already assigned to an application environment.'
      )
  }
  const claim = await DomainClaim.findOne({ domain })
  if (claim && claim.owner !== owner(service.id))
    custom.fail('This domain is already assigned to another resource.')
}
async function review(service, actor, domain, port) {
  domain = String(domain || '')
    .trim()
    .toLowerCase()
  const removal = !domain
  if (service.publicRoute?.operation || service.customState?.update)
    custom.fail('Recover the unfinished route change before starting another.')
  if (
    !removal &&
    (service.status !== 'running' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535)
  )
    custom.fail(
      'Start the service and choose an internal HTTP port between 1 and 65535.'
    )
  if (removal && !service.publicRoute?.domain)
    custom.fail('This service is already private.')
  await validateDomain(domain, service)
  const expired = await CustomServiceReview.find({
    expiresAt: { '<': Date.now() - 24 * 60 * 60 * 1000 }
  }).limit(100)
  const expiredIds = expired
    .filter((item) => item.imageMetadata?.purpose === 'service-route')
    .map((item) => item.id)
  if (expiredIds.length)
    await CustomServiceReview.destroy({ id: { in: expiredIds } })
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
    imageReference: service.imageReference || 'route',
    imageMetadata: { purpose: 'service-route' },
    definition: {
      domain,
      port: removal ? null : port,
      fingerprint: fingerprint(service)
    },
    expiresAt: Date.now() + 10 * 60 * 1000
  }).fetch()
  return {
    id: item.token,
    domain: domain || null,
    port: removal ? null : port,
    endpoint: removal ? null : `http://${service.containerName}:${port}`,
    expiresAt: item.expiresAt,
    removal
  }
}
async function state(name, serviceId) {
  try {
    const data = JSON.parse((await custom.command(['inspect', name])).stdout)[0]
    if (data.Config?.Labels?.['slipway.service-route'] !== String(serviceId))
      custom.fail(
        'The route container belongs to another resource. It was left unchanged.'
      )
    return { exists: true, running: Boolean(data.State.Running) }
  } catch (error) {
    if (error.code === 'DOCKER_MISSING')
      return { exists: false, running: false }
    throw error
  }
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
async function apply(item, actor) {
  const id = String(item.serviceId)
  if (active.has(id)) custom.fail('A route change is already running.')
  active.add(id)
  let operation
  try {
    const service = await Service.findOne({ id })
    if (item.imageMetadata?.completed) return service
    if (
      item.expiresAt <= Date.now() ||
      item.definition?.fingerprint !== fingerprint(service)
    )
      custom.fail('This review is stale. Review the route again.')
    await validateDomain(item.definition.domain, service)
    const routeId = `slipway-route-service-${id}`
    const previous = service.publicRoute || {}
    const old = await state(routeId, id)
    const suffix = crypto.randomUUID()
    operation = {
      id: suffix,
      previous,
      previousStatus: service.status,
      domain: item.definition.domain,
      port: item.definition.port,
      transaction: {
        routeId,
        candidateRouteId: `${routeId}-candidate-${suffix}`,
        previousRouteId: `${routeId}-previous-${suffix}`,
        removal: !item.definition.domain,
        previousExists: old.exists,
        previousWasRunning: old.running,
        previousDomains: previous.domain ? [previous.domain] : [],
        candidateDomains: item.definition.domain
          ? [item.definition.domain]
          : [],
        previousUpstreams: previous.domain
          ? [`${service.containerName}:${previous.port}`]
          : [],
        candidateUpstreams: item.definition.domain
          ? [`${service.containerName}:${item.definition.port}`]
          : [],
        retainPrevious: true,
        retainClaims: true,
        claimOwner: owner(id)
      }
    }
    await transaction(async (db) => {
      await custom.available(service.environment, actor.project.id, id, db)
      const current = await Service.findOne({ id }).usingConnection(db)
      const currentReview = await CustomServiceReview.findOne({ id: item.id })
        .decrypt()
        .usingConnection(db)
      if (
        !current ||
        current.publicRoute?.operation ||
        current.customState?.update ||
        ['creating', 'changing', 'upgrading', 'restoring'].includes(
          current.status
        ) ||
        fingerprint(current) !== item.definition.fingerprint ||
        currentReview?.imageMetadata?.consumed ||
        currentReview?.expiresAt <= Date.now()
      )
        custom.fail('The service or review changed. Refresh and review again.')
      await claims.reserve(
        [operation.domain, previous.domain].filter(Boolean),
        owner(id),
        db
      )
      await Service.updateOne({ id })
        .set({
          status: 'changing',
          publicRoute: { ...previous, operation, error: null }
        })
        .usingConnection(db)
      await CustomServiceReview.updateOne({ id: item.id })
        .set({ imageMetadata: { purpose: 'service-route', consumed: true } })
        .usingConnection(db)
      await audit(
        service,
        actor,
        'service.route.requested',
        { domain: operation.domain || null, port: operation.port },
        db
      )
    })
    try {
      if (!operation.transaction.removal) {
        const args =
          await require('../helpers/caddy/update-route')._private.buildCreateArgs(
            {
              candidateName: operation.transaction.candidateRouteId,
              network: sails.config.custom.slipwayNetwork || 'slipway',
              config: {
                domains: [operation.domain],
                projectSlug: actor.project.slug,
                environmentSlug: actor.environment.slug
              },
              routableApps: [
                {
                  containerName: service.containerName,
                  port: operation.port,
                  routePath: '/'
                }
              ]
            }
          )
        args.splice(
          args.length - 3,
          0,
          '--label',
          `slipway.service-route=${id}`
        )
        await custom.command(args)
        await custom.command(['start', operation.transaction.candidateRouteId])
        await sails.helpers.caddy.verifyRoute.with({
          expectedDomains: [operation.domain],
          expectedUpstreams: operation.transaction.candidateUpstreams
        })
      }
      await sails.helpers.caddy.finishRouteUpdate.with({
        action: 'commit',
        transaction: operation.transaction
      })
      await transaction(async (db) => {
        await Service.updateOne({ id })
          .set({
            status: operation.previousStatus,
            publicRoute: {
              domain: operation.domain || null,
              port: operation.port,
              version: suffix,
              retainedRoutes: [
                ...(previous.retainedRoutes || []),
                ...(operation.transaction.previousExists &&
                !operation.transaction.removal
                  ? [operation.transaction.previousRouteId]
                  : [])
              ],
              route: operation.domain ? 'verified' : 'private',
              dns: 'unverified',
              tls: 'unverified',
              checkedAt: Date.now()
            }
          })
          .usingConnection(db)
        await CustomServiceReview.updateOne({ id: item.id })
          .set({
            imageMetadata: { purpose: 'service-route', completed: true },
            definition: {}
          })
          .usingConnection(db)
        await audit(
          service,
          actor,
          operation.domain
            ? 'service.route.published'
            : 'service.route.removed',
          { domain: operation.domain || null, port: operation.port },
          db
        )
      })
      await claims
        .release(owner(id), operation.domain ? [operation.domain] : [])
        .catch(() => {})
      if (
        operation.transaction.previousExists &&
        !operation.transaction.removal
      )
        await custom
          .command(['rm', '-f', operation.transaction.previousRouteId])
          .catch(() => {})
      return Service.findOne({ id })
    } catch (error) {
      await rollback(service, operation, actor).catch(async () => {
        await Service.updateOne({ id }).set({
          status: 'failed',
          publicRoute: {
            ...previous,
            operation,
            error:
              'Route change and recovery could not finish. Recover the previous route before retrying.'
          }
        })
      })
      custom.fail(
        'The route change failed. Refresh the service to check recovery before retrying.'
      )
    }
  } finally {
    active.delete(id)
  }
}
async function rollback(service, operation, actor) {
  await sails.helpers.caddy.finishRouteUpdate.with({
    action: 'rollback',
    transaction: operation.transaction
  })
  await transaction(async (db) => {
    await Service.updateOne({ id: service.id })
      .set({
        status: operation.previousStatus,
        publicRoute: {
          ...operation.previous,
          error:
            'The previous route was restored. Review the change again to retry.'
        }
      })
      .usingConnection(db)
    await audit(
      service,
      actor,
      'service.route.recovered',
      { domain: operation.previous.domain || null },
      db
    )
  })
  await claims.release(
    owner(service.id),
    operation.previous.domain ? [operation.previous.domain] : []
  )
}
async function recover(service, actor) {
  const id = String(service.id)
  if (active.has(id) || service.status === 'changing')
    custom.fail('Wait for the active route operation to finish.')
  if (!service.publicRoute?.operation) return service
  const locked = await Service.updateOne({ id, status: service.status }).set({
    status: 'changing'
  })
  if (!locked) custom.fail('Another service operation is running.')
  active.add(id)
  try {
    await rollback(service, service.publicRoute.operation, actor)
    return Service.findOne({ id })
  } catch (error) {
    await Service.updateOne({ id }).set({ status: 'failed' })
    throw error
  } finally {
    active.delete(id)
  }
}
module.exports = { review, apply, recover, validateDomain, fingerprint }
