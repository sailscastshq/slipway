const recovery = require('../../lib/deployment-recovery')
const ACTIVE = new Set(['pending', 'building', 'pushing', 'deploying'])
const SUCCESSFUL = new Set(['running', 'stopped'])
const TERMINAL_JOBS = new Set(['complete', 'failed', 'cancelled'])
const MANAGED_TAG = /^slipway\/[a-z0-9][a-z0-9-]*:[1-9][0-9]*$/

module.exports = {
  friendlyName: 'Get image retention plan',
  description:
    'Protect live work and recovery references before identifying old deployment images.',
  inputs: {
    inventory: { type: 'ref', required: true },
    policy: { type: 'ref', required: true },
    now: { type: 'number', defaultsTo: 0 }
  },
  exits: { success: { outputType: 'ref' } },

  fn: async function ({ inventory, policy, now }) {
    now ||= Date.now()
    const [deployments, apps, jobs, services, cleanups, recoveryRows] =
      await Promise.all([
        read(Deployment, {}, [
          'id',
          'app',
          'environment',
          'status',
          'imageName',
          'imageId',
          'createdAt'
        ]),
        read(App, {}, [
          'id',
          'environment',
          'imageName',
          'imageId',
          'currentDeployment'
        ]),
        read(DeploymentJob, {}, [
          'id',
          'deployment',
          'targetDeploymentId',
          'imageName',
          'stage'
        ]),
        read(Service, {}, [
          'id',
          'type',
          'status',
          'managementMode',
          'imageReference',
          'imageMetadata',
          'customRecovery'
        ]),
        read(CleanupOperation, { retentionPolicy: 'retain' }, [
          'id',
          'snapshot'
        ]),
        read(Setting, { key: { startsWith: 'deploymentRecovery' } }, [
          'key',
          'value'
        ])
      ])
    const aliases = new Map()
    const holds = new Set()
    const protectedIds = new Map()
    const deploymentById = new Map(
      deployments.map((item) => [String(item.id), item])
    )
    for (const image of inventory.images) {
      for (const ref of [image.id, ...image.tags, ...image.digests]) {
        if (aliases.has(ref) && aliases.get(ref) !== image.id)
          throw new Error('Image retention found an ambiguous image reference')
        aliases.set(ref, image.id)
      }
    }
    for (const container of inventory.containers)
      protect(container.imageId, 'container')
    for (const ref of policy.pinnedImages) protect(ref, 'pin')
    for (const app of apps) {
      protectRecord(app, 'current-app')
      if (app.currentDeployment)
        protectDeployment(app.currentDeployment, 'current-release')
    }
    for (const row of recoveryRows) {
      if (row.key.startsWith(recovery.HOLD_PREFIX)) {
        holds.add('Traffic recovery requires operator inspection')
        continue
      }
      let state
      try {
        state = recovery.parse(row.value)
      } catch {
        holds.add('Recovery metadata could not be verified')
        continue
      }
      const app = apps.find((item) => recovery.id(item.id) === state.appId)
      if (
        row.key !== recovery.key(state.appId) ||
        !app ||
        recovery.id(app.environment) !== state.environmentId ||
        recovery.id(app.currentDeployment) !==
          recovery.id(state.current.deploymentId) ||
        app.imageId !== state.current.imageId
      ) {
        holds.add('Recovery metadata does not match the app traffic owner')
        continue
      }
      protect(state.current.imageId, 'recovery-current')
      if (state.previous) protect(state.previous.imageId, 'recovery-previous')
    }
    for (const deployment of deployments) {
      if (ACTIVE.has(deployment.status))
        protectRecord(deployment, 'active-deployment')
      if (!deployment.app && SUCCESSFUL.has(deployment.status))
        protectRecord(deployment, 'legacy-rollback')
    }
    for (const job of jobs) {
      if (TERMINAL_JOBS.has(job.stage)) continue
      if (job.imageName) protect(job.imageName, 'active-job')
      protectDeployment(job.deployment, 'active-job')
      if (job.targetDeploymentId)
        protectDeployment(job.targetDeploymentId, 'rollback-job')
    }
    const groups = new Map()
    for (const deployment of deployments
      .filter((item) => SUCCESSFUL.has(item.status) && item.app)
      .sort(
        (a, b) => b.createdAt - a.createdAt || Number(b.id) - Number(a.id)
      )) {
      if (!deployment.environment || !Number.isFinite(deployment.createdAt))
        throw new Error('Image retention cannot order successful deployments')
      const key = `${normalizeId(deployment.environment)}:${normalizeId(
        deployment.app
      )}`
      const retained = groups.get(key) || new Set()
      if (retained.size < policy.keepSuccessful) {
        const id = protectRecord(deployment, 'recent-success')
        if (!id)
          holds.add(
            `Successful deployment ${deployment.id} has no resolved image`
          )
        else retained.add(id)
      }
      groups.set(key, retained)
    }
    for (const service of services) {
      if (service.managementMode === 'external') continue
      if (service.imageReference) protect(service.imageReference, 'service')
      else if (
        ['running', 'stopped', 'upgrading', 'restoring', 'changing'].includes(
          service.status
        )
      )
        holds.add(`Service ${service.id} has no image reference`)
      collectRecovery(service.imageMetadata, 'service-recovery')
      collectRecovery(service.customRecovery, 'custom-service-recovery')
    }
    for (const cleanup of cleanups) {
      for (const ref of cleanup.snapshot?.artifacts?.recoveryImageIds || [])
        protect(ref, 'retained-recovery')
      for (const ref of cleanup.snapshot?.artifacts?.imageNames || [])
        protect(ref, 'retained-resource')
      for (const service of cleanup.snapshot?.services || []) {
        if (service.imageReference)
          protect(service.imageReference, 'retained-service')
        collectRecovery(service.imageMetadata, 'retained-service-recovery')
        collectRecovery(service.customRecovery, 'retained-service-recovery')
      }
    }
    const ownedNames = new Set(
      deployments
        .filter(
          (item) =>
            item.app &&
            item.environment &&
            MANAGED_TAG.test(item.imageName || '') &&
            item.imageName.endsWith(`:${item.id}`)
        )
        .map((item) => item.imageName)
    )
    const cutoff = now - policy.minimumAgeDays * 86400000
    const images = inventory.images.map((image) => {
      const reasons = [...(protectedIds.get(image.id) || [])]
      // Only named images with matching deployment records are identifiable here.
      // All control-plane releases, unknown aliases and untagged legacy images stay.
      if (!image.tags.length || image.tags.some((tag) => !ownedNames.has(tag)))
        reasons.push('unknown-or-out-of-scope')
      // Tag removal can also detach repository-digest aliases, which are not
      // deployment-owned tags. Retain the whole image instead.
      if (image.digests.length) reasons.push('digest-reference')
      if (Date.parse(image.created) >= cutoff) reasons.push('minimum-age')
      return { id: image.id, tags: image.tags, sizeBytes: image.size, reasons }
    })
    return {
      status: holds.size ? 'held' : 'planned',
      holds: [...holds],
      candidates: holds.size
        ? []
        : images.filter((image) => !image.reasons.length),
      protected: images.filter((image) => image.reasons.length),
      // Virtual image sizes share layers; never present their sum as reclaimed bytes.
      counts: { images: images.length, containers: inventory.containers.length }
    }

    async function read(model, criteria, select) {
      const rows = await model
        .find(criteria)
        .select(select)
        .limit(policy.maxRecords + 1)
      if (rows.length > policy.maxRecords)
        throw new Error(
          'Image retention reference inventory exceeds its configured limit'
        )
      return rows
    }
    function protect(ref, reason) {
      if (!ref || typeof ref !== 'string') {
        holds.add(`Invalid ${reason} image reference`)
        return
      }
      const id = aliases.get(ref) || aliases.get(`sha256:${ref}`)
      if (!id) {
        holds.add(`Unresolved ${reason} reference: ${ref}`)
        return
      }
      const reasons = protectedIds.get(id) || new Set()
      reasons.add(reason)
      protectedIds.set(id, reasons)
      return id
    }
    function protectRecord(record, reason) {
      const ids = new Set()
      for (const ref of [record.imageName, record.imageId].filter(Boolean)) {
        const id = protect(ref, reason)
        if (id) ids.add(id)
      }
      if (ids.size > 1) holds.add(`Conflicting ${reason} image identities`)
      return [...ids][0]
    }
    function protectDeployment(value, reason) {
      const record = deploymentById.get(String(normalizeId(value)))
      if (!record) holds.add(`Unresolved ${reason} deployment`)
      else protectRecord(record, reason)
    }
    function collectRecovery(value, reason, depth = 0) {
      if (!value) return
      if (depth > 30)
        throw new Error('Image recovery reference nesting exceeds its limit')
      if (typeof value !== 'object')
        throw new Error('Invalid image recovery metadata')
      for (const [key, item] of Object.entries(value)) {
        if (['imageReference', 'imageId', 'repoDigest'].includes(key) && item)
          protect(item, reason)
        else if (item && typeof item === 'object')
          collectRecovery(item, reason, depth + 1)
      }
    }
  }
}

function normalizeId(value) {
  return value && typeof value === 'object' ? value.id : value
}
