const deploymentCancellation = require('../../lib/deployment-cancellation')

const STAGES = [
  ['traffic', removeTraffic],
  ['work', stopRunningWork],
  ['containers', removeContainers],
  ['ports', releasePorts],
  ['records', removeRecords],
  ['artifacts', removeArtifacts]
]
const ACTIVE_DEPLOYMENT_STATUSES = [
  'pending',
  'building',
  'pushing',
  'deploying'
]
const ACTIVE_JOB_STAGES = [
  'queued',
  'claimed',
  'initialization',
  'source_preparation',
  'image_build',
  'container_startup',
  'health_check',
  'traffic_cutover',
  'cleanup',
  'cancel_requested'
]
const CLAIM_TIMEOUT = 60 * 1000

module.exports = {
  friendlyName: 'Run resource cleanup',

  description:
    'Create or resume one durable, idempotent destructive cleanup operation.',

  inputs: {
    targetKey: {
      type: 'string',
      required: true
    },
    requestKey: {
      type: 'string'
    },
    scopeType: {
      type: 'string',
      required: true,
      isIn: ['project', 'environment', 'app', 'service']
    },
    resourceId: {
      type: 'number'
    },
    retentionPolicy: {
      type: 'string',
      isIn: ['retain', 'purge'],
      defaultsTo: 'retain'
    },
    userId: {
      type: 'number'
    },
    teamId: {
      type: 'number',
      required: true
    },
    ipAddress: {
      type: 'string',
      allowNull: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    notFound: {}
  },

  fn: async function ({
    targetKey,
    requestKey,
    scopeType,
    resourceId,
    retentionPolicy,
    userId,
    teamId,
    ipAddress
  }) {
    let operation = await CleanupOperation.findOne({ targetKey })

    if (!operation) {
      if (!resourceId) throw 'notFound'
      const snapshot = await sails.helpers.cleanup.createSnapshot
        .with({ scopeType, resourceId })
        .intercept('notFound', 'notFound')

      if (Number(snapshot.target.teamId) !== Number(teamId)) {
        throw 'notFound'
      }

      try {
        operation = await CleanupOperation.create({
          targetKey,
          requestKey: requestKey || targetKey,
          scopeType,
          resourceId,
          projectId: snapshot.target.projectId,
          environmentId: snapshot.target.environmentId,
          appId: snapshot.target.appId,
          serviceId: snapshot.target.serviceId,
          retentionPolicy,
          status: 'pending',
          stage: 'pending',
          snapshot,
          requestedBy: userId || null,
          team: teamId,
          ipAddress: ipAddress || null
        }).fetch()
      } catch (error) {
        if (!isUniqueConflict(error)) throw error
        operation = await CleanupOperation.findOne({ targetKey })
      }
    }

    if (!operation || Number(normalizeId(operation.team)) !== Number(teamId)) {
      throw 'notFound'
    }

    if (operation.status === 'complete') {
      return serialize(operation)
    }

    if (
      operation.status === 'running' &&
      Date.now() - operation.updatedAt < CLAIM_TIMEOUT
    ) {
      throw cleanupError(
        'Cleanup is already running. Try again in a moment.',
        'CLEANUP_IN_PROGRESS',
        operation
      )
    }

    const claimedOperation = await CleanupOperation.updateOne({
      id: operation.id,
      status: operation.status,
      updatedAt: operation.updatedAt
    }).set({
      status: 'running',
      errorMessage: null
    })

    if (!claimedOperation) {
      operation = await CleanupOperation.findOne({ id: operation.id })
      if (operation?.status === 'complete') return serialize(operation)
      throw cleanupError(
        'Cleanup is already running. Try again in a moment.',
        'CLEANUP_IN_PROGRESS',
        operation
      )
    }

    operation = claimedOperation

    if (operation.stage === 'pending') {
      const refreshedSnapshot = await sails.helpers.cleanup.createSnapshot
        .with({
          scopeType: operation.scopeType,
          resourceId: operation.resourceId
        })
        .tolerate('notFound', () => null)

      if (refreshedSnapshot) {
        operation = await CleanupOperation.updateOne({ id: operation.id }).set({
          snapshot: refreshedSnapshot
        })
      }

      await recordAudit(operation, 'cleanup.started', {
        retentionPolicy: operation.retentionPolicy
      })
    }

    for (const [stageName, handler] of STAGES) {
      operation = await CleanupOperation.findOne({ id: operation.id })
      if (operation.stages?.[stageName]?.status === 'complete') continue

      try {
        const outcome = await handler(operation)
        const stages = {
          ...(operation.stages || {}),
          [stageName]: {
            status: 'complete',
            completedAt: Date.now(),
            outcome: outcome || {}
          }
        }
        operation = await CleanupOperation.updateOne({ id: operation.id }).set({
          stage: stageName,
          stages
        })
        await recordAudit(operation, 'cleanup.stage.completed', {
          stage: stageName,
          outcome: outcome || {}
        })
      } catch (error) {
        operation = await recordFailure(operation, stageName, error)
        throw cleanupError(
          `Cleanup paused during ${humanize(stageName)}: ${
            error.message || error
          }`,
          error.code || 'CLEANUP_RETRYABLE',
          operation
        )
      }
    }

    operation = await CleanupOperation.updateOne({ id: operation.id }).set({
      status: 'complete',
      stage: 'complete',
      completedAt: Date.now(),
      errorMessage: null
    })
    await recordAudit(operation, 'cleanup.completed', {
      retentionPolicy: operation.retentionPolicy,
      warnings: operation.warnings || []
    })

    return serialize(operation)
  }
}

async function removeTraffic(operation) {
  const routes = operation.snapshot.artifacts?.routes || []
  const outcomes = []

  for (const route of routes) {
    if (route.action === 'update') {
      const apps = (
        await App.find({ environment: route.environmentId })
      ).filter((app) => !route.excludedAppIds.includes(app.id))
      outcomes.push(
        await sails.helpers.caddy.updateRoute.with({
          environmentId: route.environmentId,
          apps,
          routeVersion: `cleanup-${operation.id}`
        })
      )
      continue
    }

    outcomes.push(
      await sails.helpers.caddy.removeRoute.with({
        projectSlug: route.projectSlug,
        environmentSlug: route.environmentSlug
      })
    )
  }

  return { routes: outcomes }
}

async function stopRunningWork(operation) {
  const deploymentIds = operation.snapshot.records?.deploymentIds || []
  if (deploymentIds.length === 0) return { cancelled: 0 }

  const activeDeployments = await Deployment.find({
    id: { in: deploymentIds },
    status: { in: ACTIVE_DEPLOYMENT_STATUSES }
  })
  const jobs = await DeploymentJob.find({
    deployment: { in: deploymentIds },
    stage: { in: ACTIVE_JOB_STAGES }
  })
  const leases = await DeploymentLease.find({
    deployment: { in: deploymentIds }
  })
  const liveLeases = []

  for (const deployment of activeDeployments) {
    deploymentCancellation.request(
      deployment.id,
      `Cancelled by cleanup operation ${operation.id}`
    )
  }

  for (const lease of leases) {
    if (lease.expiresAt && lease.expiresAt <= Date.now()) {
      await DeploymentLease.destroyOne({ id: lease.id })
    } else {
      liveLeases.push(lease)
    }
  }

  for (const job of jobs) {
    const hasLiveLease = liveLeases.some(
      (lease) => normalizeId(lease.deployment) === normalizeId(job.deployment)
    )
    await DeploymentJob.updateOne({ id: job.id }).set({
      stage: hasLiveLease ? 'cancel_requested' : 'cancelled'
    })
  }

  if (activeDeployments.length > 0) {
    await Deployment.update({
      id: { in: activeDeployments.map((item) => item.id) }
    }).set({
      status: 'cancelled',
      errorMessage: `Cancelled by cleanup operation ${operation.id}`,
      finishedAt: Date.now()
    })
  }

  if (liveLeases.length > 0) {
    const error = new Error(
      `${liveLeases.length} deployment worker${
        liveLeases.length === 1 ? ' is' : 's are'
      } still stopping`
    )
    error.code = 'CLEANUP_ACTIVE_WORK'
    throw error
  }

  return { cancelled: activeDeployments.length, jobs: jobs.length }
}

async function removeContainers(operation) {
  const containerNames = operation.snapshot.artifacts?.containerNames || []
  let removed = 0
  let missing = 0

  for (const containerName of containerNames) {
    try {
      await sails.helpers.docker.stopContainer.with({ containerName })
      removed += 1
    } catch (error) {
      if (!isMissingResource(error)) throw error
      missing += 1
    }
  }

  return { removed, missing }
}

async function releasePorts(operation) {
  const records = operation.snapshot.records || {}
  const artifacts = operation.snapshot.artifacts || {}
  let released = 0

  if ((artifacts.portReservationIds || []).length > 0) {
    released += (
      await PortReservation.destroy({
        id: { in: artifacts.portReservationIds }
      }).fetch()
    ).length
  }

  const deploymentIds = (records.deploymentIds || []).map(String)
  if (deploymentIds.length > 0) {
    released += (
      await PortReservation.destroy({
        ownerType: 'deployment',
        ownerId: { in: deploymentIds }
      }).fetch()
    ).length
  }

  return { released }
}

async function removeRecords(operation) {
  return sails.helpers.cleanup.removeRecords.with({
    snapshot: operation.snapshot
  })
}

async function removeArtifacts(operation) {
  return sails.helpers.cleanup.removeArtifacts.with({
    snapshot: operation.snapshot,
    retentionPolicy: operation.retentionPolicy
  })
}

async function recordFailure(operation, stageName, error) {
  const warning = {
    stage: stageName,
    message: error.message || String(error),
    code: error.code || 'CLEANUP_RETRYABLE',
    occurredAt: Date.now()
  }
  const stages = {
    ...(operation.stages || {}),
    [stageName]: {
      status: 'failed',
      failedAt: warning.occurredAt,
      error: warning
    }
  }

  // A deployment worker can restore a route while it unwinds. Re-run the
  // traffic stage after active work has fully stopped.
  if (stageName === 'work' && stages.traffic) {
    stages.traffic = {
      ...stages.traffic,
      status: 'pending',
      retryReason: 'running work was still stopping'
    }
  }

  const updated = await CleanupOperation.updateOne({ id: operation.id }).set({
    status: 'failed',
    stage: stageName,
    stages,
    warnings: [...(operation.warnings || []), warning],
    errorMessage: warning.message
  })
  await recordAudit(updated, 'cleanup.stage.failed', warning)
  return updated
}

async function recordAudit(operation, action, details) {
  await sails.helpers.audit.log.with({
    action,
    resourceType: operation.scopeType,
    resourceId: String(operation.resourceId),
    details: {
      cleanupOperationId: operation.id,
      targetKey: operation.targetKey,
      ...details
    },
    userId: normalizeId(operation.requestedBy) || undefined,
    teamId: normalizeId(operation.team),
    ipAddress: operation.ipAddress || undefined
  })
}

function serialize(operation) {
  const artifactOutcome = operation.stages?.artifacts?.outcome || {}
  return {
    id: operation.id,
    targetKey: operation.targetKey,
    requestKey: operation.requestKey,
    scopeType: operation.scopeType,
    resourceId: operation.resourceId,
    label: operation.snapshot?.target?.label || null,
    status: operation.status,
    stage: operation.stage,
    retentionPolicy: operation.retentionPolicy,
    stages: operation.stages || {},
    warnings: operation.warnings || [],
    retainedArtifacts: artifactOutcome.retained || {},
    completedAt: operation.completedAt || null,
    errorMessage: operation.errorMessage || null
  }
}

function cleanupError(message, code, operation) {
  const error = new Error(message)
  error.code = code
  error.cleanup = serialize(operation)
  return error
}

function isUniqueConflict(error) {
  return (
    error?.code === 'E_UNIQUE' ||
    /unique|constraint/i.test(error?.message || '')
  )
}

function isMissingResource(error) {
  return (
    error === 'notFound' ||
    error?.code === 'notFound' ||
    /not found|no such container/i.test(error?.message || '')
  )
}

function humanize(value) {
  return String(value).replace(/_/g, ' ')
}

function normalizeId(value) {
  return value && typeof value === 'object' ? value.id : value
}
