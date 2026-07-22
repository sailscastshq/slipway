const crypto = require('node:crypto')
const os = require('node:os')

const LEASE_TTL = 30 * 1000
const HEARTBEAT_INTERVAL = 10 * 1000

module.exports = {
  friendlyName: 'Run queued deployments',

  description:
    'Claim and run the oldest queued deployment for each available environment.',

  inputs: {
    targetKey: {
      type: 'string',
      description: 'Optional environment queue to drain.'
    }
  },

  fn: async function ({ targetKey }) {
    const criteria = { stage: 'queued' }
    if (targetKey) criteria.targetKey = targetKey

    const queuedJobs = await DeploymentJob.find(criteria).sort([
      'createdAt ASC',
      'id ASC'
    ])
    const targetKeys = [...new Set(queuedJobs.map((job) => job.targetKey))]

    await Promise.all(targetKeys.map((key) => drainTarget(key)))

    return { targets: targetKeys.length }
  }
}

async function drainTarget(targetKey) {
  while (true) {
    const claimed = await claimNextJob(targetKey)
    if (!claimed) return

    await runClaimedJob(claimed)
  }
}

async function claimNextJob(targetKey) {
  const jobs = await DeploymentJob.find({ targetKey, stage: 'queued' }).sort([
    'createdAt ASC',
    'id ASC'
  ])

  for (const job of jobs) {
    const deployment = await Deployment.findOne({ id: job.deployment })
    if (!deployment || deployment.status === 'cancelled') {
      await DeploymentJob.updateOne({ id: job.id, stage: 'queued' }).set({
        stage: 'cancelled'
      })
      continue
    }

    if (deployment.status !== 'pending') {
      await DeploymentJob.updateOne({ id: job.id, stage: 'queued' }).set({
        stage: isSuccessfulStatus(deployment.status) ? 'complete' : 'failed'
      })
      continue
    }

    const now = Date.now()
    const token = crypto.randomUUID()
    let lease

    try {
      lease = await DeploymentLease.create({
        targetKey,
        deployment: deployment.id,
        token,
        owner: `${os.hostname()}:${process.pid}`,
        stage: 'claimed',
        heartbeatAt: now,
        expiresAt: now + LEASE_TTL
      }).fetch()
    } catch (error) {
      if (isUniqueConflict(error)) return null
      throw error
    }

    const claimedJob = await DeploymentJob.updateOne({
      id: job.id,
      stage: 'queued'
    }).set({
      stage: 'claimed',
      attempt: job.attempt + 1
    })

    if (!claimedJob) {
      await DeploymentLease.destroyOne({ id: lease.id, token })
      continue
    }

    await Deployment.updateOne({ id: deployment.id, status: 'pending' }).set({
      startedAt: deployment.startedAt || now
    })

    return { job: claimedJob, deployment, lease }
  }

  return null
}

async function runClaimedJob({ job, deployment, lease }) {
  const heartbeat = setInterval(async () => {
    try {
      const now = Date.now()
      const renewed = await DeploymentLease.updateOne({
        id: lease.id,
        token: lease.token
      }).set({
        heartbeatAt: now,
        expiresAt: now + LEASE_TTL
      })
      if (!renewed) clearInterval(heartbeat)
    } catch (error) {
      sails.log.warn(
        `Could not heartbeat deployment ${deployment.id}: ${
          error.message || error
        }`
      )
    }
  }, HEARTBEAT_INTERVAL)

  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  try {
    const environment = await Environment.findOne({
      id: deployment.environment
    }).populate('project')
    if (!environment?.project) {
      throw new Error(
        `Deployment ${deployment.id} has no deployable environment.`
      )
    }

    const app = deployment.app
      ? await App.findOne({ id: deployment.app })
      : await App.findOne({
          environment: environment.id,
          slug: job.appSlug
        })

    await DeploymentJob.updateOne({ id: job.id }).set({
      previousContainerName: app?.containerName || null
    })

    if (job.kind === 'rollback') {
      const targetDeployment = await Deployment.findOne({
        id: job.targetDeploymentId
      })
      if (!targetDeployment?.imageName) {
        throw new Error(
          `Rollback source deployment ${job.targetDeploymentId} is unavailable.`
        )
      }

      await sails.helpers.deploy.executeRollback.with({
        rollbackId: deployment.id,
        targetDeployment,
        environment,
        app,
        leaseToken: lease.token
      })
    } else {
      await sails.helpers.deploy.executePipeline.with({
        deploymentId: deployment.id,
        project: environment.project,
        environment,
        app,
        leaseToken: lease.token
      })
    }
  } catch (error) {
    const errorMessage = error.message || String(error)
    sails.log.error(
      `Deployment worker ${deployment.id} stopped: ${errorMessage}`
    )

    // Pipeline helpers persist their own failures, but coordinator preflight
    // can also fail (for example, a deleted environment or rollback source).
    // Never leave that durable job failed while its Deployment still appears
    // pending forever.
    const current = await Deployment.findOne({ id: deployment.id })
    if (
      current &&
      !['running', 'stopped', 'failed', 'cancelled'].includes(current.status)
    ) {
      const failed = await sails.helpers.deploy.updateDeploymentForLease.with({
        deploymentId: deployment.id,
        leaseToken: lease.token,
        values: {
          status: 'failed',
          errorMessage,
          finishedAt: Date.now()
        }
      })
      if (failed.valid) {
        try {
          await Deployment.appendDeployLog(
            deployment.id,
            `\nERROR [coordinator]: ${errorMessage}\n`
          )
        } catch {
          // Failure state is authoritative; diagnostics are best-effort.
        }
      }
    }
  } finally {
    clearInterval(heartbeat)

    const ownedLease = await DeploymentLease.findOne({
      id: lease.id,
      token: lease.token
    })

    if (!ownedLease) return

    const current = await Deployment.findOne({ id: deployment.id })
    const stage =
      current?.status === 'running'
        ? 'complete'
        : current?.status === 'cancelled'
        ? 'cancelled'
        : 'failed'

    await DeploymentJob.updateOne({ id: job.id }).set({ stage })
    await DeploymentLease.destroyOne({ id: lease.id, token: lease.token })
  }
}

function isSuccessfulStatus(status) {
  return ['running', 'stopped'].includes(status)
}

function isUniqueConflict(error) {
  const code = error?.code || error?.raw?.code || error?.cause?.code
  return (
    code === 'E_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT' ||
    /unique|constraint/i.test(error?.message || '')
  )
}

module.exports._private = {
  claimNextJob,
  drainTarget,
  runClaimedJob,
  isUniqueConflict
}
