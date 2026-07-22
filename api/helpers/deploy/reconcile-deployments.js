const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const RECOVERY_LEASE_TTL = 30 * 1000
const ACTIVE_STATUSES = ['pending', 'building', 'pushing', 'deploying']
const ACTIVE_JOB_STAGES = [
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

module.exports = {
  friendlyName: 'Reconcile deployments',

  description:
    'Recover stale durable jobs and deterministically clean deployment resources left by an interrupted Slipway process.',

  inputs: {},

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function () {
    const recovered = []
    const now = Date.now()

    await PortReservation.destroy({ expiresAt: { '<': now } })

    const staleLeases = await DeploymentLease.find({
      expiresAt: { '<=': now }
    })
    for (const lease of staleLeases) {
      const claimed = await claimForRecovery(lease)
      if (!claimed) continue
      try {
        recovered.push(await recoverLease(claimed))
      } catch (error) {
        sails.log.warn(
          `Deployment recovery ${claimed.deployment} will retry: ${
            error.message || error
          }`
        )
      }
    }

    const activeJobs = await DeploymentJob.find({
      stage: { in: ACTIVE_JOB_STAGES }
    })
    for (const job of activeJobs) {
      const existingLease = await DeploymentLease.findOne({
        deployment: job.deployment
      })
      if (existingLease) continue

      const claimed = await createRecoveryLease(job)
      if (!claimed) continue
      try {
        recovered.push(await recoverLease(claimed))
      } catch (error) {
        sails.log.warn(
          `Deployment recovery ${claimed.deployment} will retry: ${
            error.message || error
          }`
        )
      }
    }

    const activeDeployments = await Deployment.find({
      status: { in: ACTIVE_STATUSES }
    })
    for (const deployment of activeDeployments) {
      const job = await DeploymentJob.findOne({ deployment: deployment.id })
      if (job) continue
      try {
        recovered.push(await recoverLegacyDeployment(deployment))
      } catch (error) {
        sails.log.warn(
          `Legacy deployment recovery ${deployment.id} will retry: ${
            error.message || error
          }`
        )
      }
    }

    return { recovered }
  }
}

async function claimForRecovery(lease) {
  const now = Date.now()
  const token = crypto.randomUUID()
  return DeploymentLease.updateOne({
    id: lease.id,
    token: lease.token,
    expiresAt: { '<=': now }
  }).set({
    token,
    owner: `recovery:${os.hostname()}:${process.pid}`,
    stage: 'recovering',
    heartbeatAt: now,
    expiresAt: now + RECOVERY_LEASE_TTL
  })
}

async function createRecoveryLease(job) {
  const now = Date.now()
  try {
    return await DeploymentLease.create({
      targetKey: job.targetKey,
      deployment: job.deployment,
      token: crypto.randomUUID(),
      owner: `recovery:${os.hostname()}:${process.pid}`,
      stage: 'recovering',
      heartbeatAt: now,
      expiresAt: now + RECOVERY_LEASE_TTL
    }).fetch()
  } catch (error) {
    if (/unique|constraint/i.test(error.message || '')) return null
    throw error
  }
}

async function recoverLease(lease) {
  const [job, deployment] = await Promise.all([
    DeploymentJob.findOne({ deployment: lease.deployment }),
    Deployment.findOne({ id: lease.deployment })
  ])

  if (!job || !deployment) {
    await DeploymentLease.destroyOne({ id: lease.id, token: lease.token })
    return { deploymentId: lease.deployment, action: 'discarded' }
  }

  await DeploymentJob.updateOne({ id: job.id }).set({ stage: 'recovering' })

  const app = deployment.app
    ? await App.findOne({ id: deployment.app })
    : await App.findOne({
        environment: deployment.environment,
        slug: job.appSlug
      })
  const candidateIsCurrent = Boolean(
    app &&
      app.currentDeployment === deployment.id &&
      (!job.candidateContainerName ||
        app.containerName === job.candidateContainerName)
  )

  if (candidateIsCurrent) {
    await restoreRouteFromAppState(deployment.environment, deployment.id, {
      candidateIsCurrent: true
    })
    await stopContainer(job.previousContainerName, app.containerName)
    await markOtherDeploymentsStopped(deployment, app)
    await releasePort(deployment.id, job.hostPort)

    await Deployment.updateOne({ id: deployment.id }).set({
      status: 'running',
      finishedAt: deployment.finishedAt || Date.now(),
      errorMessage: null
    })
    await DeploymentJob.updateOne({ id: job.id }).set({ stage: 'complete' })
    await DeploymentLease.destroyOne({ id: lease.id, token: lease.token })

    await Deployment.appendDeployLog(
      deployment.id,
      'Recovery: the committed release was verified and finalized after Slipway restarted.\n'
    )

    return { deploymentId: deployment.id, action: 'finalized' }
  }

  await restoreRouteFromAppState(deployment.environment, deployment.id)
  await stopContainer(job.candidateContainerName)
  await releasePort(deployment.id, job.hostPort)
  if (job.kind === 'deploy') {
    await removeImage(job.imageName || deployment.imageName)
  }
  cleanupTemporaryBuildContext(job.buildContextPath, deployment.id)

  const wasCancelled = deployment.status === 'cancelled'
  const errorMessage = `Slipway restarted during ${humanizeStage(
    job.stage
  )}. The incomplete candidate was rolled back safely.`

  if (!wasCancelled) {
    await Deployment.updateOne({ id: deployment.id }).set({
      status: 'failed',
      errorMessage,
      finishedAt: Date.now()
    })
    await Deployment.appendDeployLog(
      deployment.id,
      `Recovery: ${errorMessage}\n`
    )
  }

  await DeploymentJob.updateOne({ id: job.id }).set({
    stage: wasCancelled ? 'cancelled' : 'failed'
  })
  await DeploymentLease.destroyOne({ id: lease.id, token: lease.token })

  return {
    deploymentId: deployment.id,
    action: wasCancelled ? 'cancelled' : 'rolled_back'
  }
}

async function recoverLegacyDeployment(deployment) {
  const app = deployment.app
    ? await App.findOne({ id: deployment.app })
    : await App.findOne({
        environment: deployment.environment,
        isDefault: true
      })
  const candidateContainerName = await App.generateDeployContainerName(
    deployment.environment,
    deployment.id,
    app?.slug
  )
  const candidateIsCurrent = Boolean(
    app &&
      app.currentDeployment === deployment.id &&
      app.containerName === candidateContainerName
  )

  if (candidateIsCurrent) {
    await restoreRouteFromAppState(deployment.environment, deployment.id, {
      candidateIsCurrent: true
    })
    await markOtherDeploymentsStopped(deployment, app)
    await releasePort(deployment.id)
    await Deployment.updateOne({ id: deployment.id }).set({
      status: 'running',
      finishedAt: deployment.finishedAt || Date.now(),
      errorMessage: null
    })
    await Deployment.appendDeployLog(
      deployment.id,
      'Recovery: the committed legacy release was verified and finalized after Slipway restarted.\n'
    )
    return { deploymentId: deployment.id, action: 'legacy_finalized' }
  }

  await restoreRouteFromAppState(deployment.environment, deployment.id)
  await stopContainer(candidateContainerName, app?.containerName)
  await releasePort(deployment.id)
  if (deployment.imageName?.endsWith(`:${deployment.id}`)) {
    await removeImage(deployment.imageName)
  }

  const errorMessage =
    'Slipway restarted before this legacy deployment had durable recovery state. Its candidate resources were rolled back safely.'
  await Deployment.updateOne({ id: deployment.id }).set({
    status: 'failed',
    errorMessage,
    finishedAt: Date.now()
  })
  await Deployment.appendDeployLog(deployment.id, `Recovery: ${errorMessage}\n`)

  return { deploymentId: deployment.id, action: 'legacy_rolled_back' }
}

async function restoreRouteFromAppState(
  environmentId,
  deploymentId,
  { candidateIsCurrent = false } = {}
) {
  if (!candidateIsCurrent) {
    await sails.helpers.caddy.cleanupRouteTransaction.with({
      environmentId,
      routeVersion: deploymentId,
      phase: 'before-repair'
    })
  }

  try {
    await sails.helpers.caddy.updateRoute.with({ environmentId })
  } catch (error) {
    sails.log.warn(
      `Could not reconcile Caddy route for environment ${environmentId}: ${
        error.message || error
      }`
    )
    throw error
  }

  await sails.helpers.caddy.cleanupRouteTransaction.with({
    environmentId,
    routeVersion: deploymentId,
    phase: 'after-repair'
  })
}

async function stopContainer(containerName, currentContainerName) {
  if (!containerName || containerName === currentContainerName) return
  try {
    await sails.helpers.docker.stopContainer.with({ containerName })
  } catch (error) {
    if (error !== 'notFound' && error?.code !== 'notFound') {
      sails.log.warn(
        `Could not clean deployment container ${containerName}: ${
          error.message || error
        }`
      )
    }
  }
}

async function releasePort(deploymentId, hostPort) {
  if (hostPort) {
    await sails.helpers.docker.releasePort.with({
      hostPort,
      ownerType: 'deployment',
      ownerId: String(deploymentId)
    })
    return
  }

  await PortReservation.destroy({
    ownerType: 'deployment',
    ownerId: String(deploymentId)
  })
}

async function removeImage(imageName) {
  if (!imageName) return
  try {
    await sails.helpers.docker.removeImage.with({ imageName })
  } catch (error) {
    sails.log.warn(
      `Could not clean deployment image ${imageName}: ${error.message || error}`
    )
  }
}

async function markOtherDeploymentsStopped(deployment, app) {
  const criteria = {
    environment: deployment.environment,
    status: 'running',
    id: { '<': deployment.id }
  }
  if (app) criteria.app = app.id
  await Deployment.update(criteria).set({ status: 'stopped' })
}

function cleanupTemporaryBuildContext(contextPath, deploymentId) {
  if (!contextPath) return
  const ownedRoot = path.join(
    os.tmpdir(),
    'slipway',
    'deployments',
    String(deploymentId)
  )
  const resolved = path.resolve(contextPath)
  if (resolved !== ownedRoot && !resolved.startsWith(`${ownedRoot}${path.sep}`))
    return
  fs.rmSync(resolved, { recursive: true, force: true })
}

function humanizeStage(stage) {
  return String(stage || 'an unknown deployment stage').replace(/_/g, ' ')
}

module.exports._private = {
  claimForRecovery,
  createRecoveryLease,
  recoverLease,
  cleanupTemporaryBuildContext
}
