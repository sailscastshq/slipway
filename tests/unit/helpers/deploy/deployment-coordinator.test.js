const { test } = require('sounding')

function deploymentWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: { slug }
    }
  }
}

test(
  'two deployments for the same app run one at a time in queue order',
  { world: deploymentWorld('serialized-deployments') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const originalExecutePipeline = sails.helpers.deploy.executePipeline
    const pipelineCalls = []
    let releaseFirst
    const firstPipelineCanFinish = new Promise((resolve) => {
      releaseFirst = resolve
    })

    sails.helpers.deploy.executePipeline = {
      with: async ({ deploymentId, leaseToken }) => {
        pipelineCalls.push(deploymentId)
        const stage = await sails.helpers.deploy.recordDeploymentStage.with({
          deploymentId,
          leaseToken,
          stage: 'image_build'
        })
        expect(stage.valid).toBe(true)
        const building =
          await sails.helpers.deploy.updateDeploymentForLease.with({
            deploymentId,
            leaseToken,
            values: { status: 'building' }
          })
        expect(building.valid).toBe(true)
        if (pipelineCalls.length === 1) await firstPipelineCanFinish
        const running =
          await sails.helpers.deploy.updateDeploymentForLease.with({
            deploymentId,
            leaseToken,
            values: { status: 'running', finishedAt: Date.now() }
          })
        expect(running.valid).toBe(true)
      }
    }

    try {
      const values = {
        triggerType: 'api',
        environment: current.environments.production.id
      }
      const queued = await Promise.all([
        sails.helpers.deploy.queueDeployment.with({
          values: { ...values },
          app: current.apps.web,
          dispatch: false
        }),
        sails.helpers.deploy.queueDeployment.with({
          values: { ...values },
          app: current.apps.web,
          dispatch: false
        })
      ])
      const jobsInOrder = await sails.models.deploymentjob
        .find({ id: { in: queued.map(({ job }) => job.id) } })
        .sort(['createdAt ASC', 'id ASC'])
      const first = queued.find(({ job }) => job.id === jobsInOrder[0].id)
      const second = queued.find(({ job }) => job.id === jobsInOrder[1].id)

      expect(queued.map((item) => item.queuePosition).sort()).toEqual([1, 2])

      const drain = sails.helpers.deploy.runQueuedDeployments
        .with({ targetKey: first.job.targetKey })
        .then((result) => result)

      await waitFor(() => pipelineCalls.length === 1)

      const queuedSecond = await sails.models.deploymentjob.findOne({
        deployment: second.deployment.id
      })
      const activeLease = await sails.models.deploymentlease.findOne({
        targetKey: first.job.targetKey
      })
      expect(queuedSecond.stage).toBe('queued')
      expect(activeLease.deployment).toBe(first.deployment.id)

      releaseFirst()
      await drain

      expect(pipelineCalls).toEqual([first.deployment.id, second.deployment.id])
      const completedJobs = await sails.models.deploymentjob.find({
        deployment: { in: [first.deployment.id, second.deployment.id] }
      })
      expect(completedJobs.every((job) => job.stage === 'complete')).toBe(true)
      expect(
        await sails.models.deploymentlease.count({
          targetKey: first.job.targetKey
        })
      ).toBe(0)
    } finally {
      releaseFirst()
      sails.helpers.deploy.executePipeline = originalExecutePipeline
    }
  }
)

test(
  'coordinator preflight failures become visible terminal deployments',
  { world: deploymentWorld('coordinator-preflight-failure') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const queued = await sails.helpers.deploy.queueDeployment.with({
      values: {
        triggerType: 'manual',
        environment: current.environments.production.id
      },
      app: current.apps.web,
      kind: 'rollback',
      targetDeploymentId: 999999,
      dispatch: false
    })

    await sails.helpers.deploy.runQueuedDeployments.with({
      targetKey: queued.job.targetKey
    })

    const [deployment, job, leaseCount] = await Promise.all([
      sails.models.deployment.findOne({ id: queued.deployment.id }),
      sails.models.deploymentjob.findOne({ id: queued.job.id }),
      sails.models.deploymentlease.count({ targetKey: queued.job.targetKey })
    ])

    expect(deployment.status).toBe('failed')
    expect(deployment.errorMessage).toContain('is unavailable')
    expect(job.stage).toBe('failed')
    expect(leaseCount).toBe(0)
  }
)

test(
  'restart before App commit restores the old route and removes the candidate',
  { world: deploymentWorld('recover-before-cutover') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      status: 'deploying',
      environment: current.environments.production.id,
      app: current.apps.web.id,
      imageName: 'slipway/recover-before:2'
    })
    const targetKey = `environment:${current.environments.production.id}`
    const job = await world.create('deploymentjob').with({
      deployment: deployment.id,
      targetKey,
      stage: 'traffic_cutover',
      candidateContainerName: 'candidate-before',
      previousContainerName: 'stable-before',
      imageName: deployment.imageName,
      hostPort: 1441
    })
    await world.create('deploymentlease').with({
      deployment: deployment.id,
      targetKey,
      token: `stale-before-${deployment.id}`,
      expiresAt: Date.now() - 1000
    })

    const doubles = installRecoveryDoubles(sails)
    try {
      const result = await sails.helpers.deploy.reconcileDeployments()

      expect(result.recovered).toEqual([
        { deploymentId: deployment.id, action: 'rolled_back' }
      ])
      const recoveredDeployment = await sails.models.deployment.findOne({
        id: deployment.id
      })
      const recoveredJob = await sails.models.deploymentjob.findOne({
        id: job.id
      })
      expect(recoveredDeployment.status).toBe('failed')
      expect(recoveredJob.stage).toBe('failed')
      expect(doubles.stopped).toEqual(['candidate-before'])
      expect(doubles.routes).toEqual([current.environments.production.id])
      expect(doubles.routeCleanups).toEqual(['before-repair', 'after-repair'])
      expect(doubles.removedImages).toEqual([deployment.imageName])
    } finally {
      doubles.restore()
    }
  }
)

test(
  'restart after App commit finalizes the candidate and retires the old release',
  { world: deploymentWorld('recover-after-cutover') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const previous = await world.create('deployment').with({
      status: 'running',
      environment: current.environments.production.id,
      app: current.apps.web.id,
      imageName: 'slipway/recover-after:1'
    })
    const deployment = await world.create('deployment').with({
      status: 'deploying',
      environment: current.environments.production.id,
      app: current.apps.web.id,
      imageName: 'slipway/recover-after:2'
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'candidate-after',
      currentDeployment: deployment.id,
      hostPort: 1442
    })

    const targetKey = `environment:${current.environments.production.id}`
    const job = await world.create('deploymentjob').with({
      deployment: deployment.id,
      targetKey,
      stage: 'traffic_cutover',
      candidateContainerName: 'candidate-after',
      previousContainerName: 'stable-after',
      imageName: deployment.imageName,
      hostPort: 1442
    })
    await world.create('deploymentlease').with({
      deployment: deployment.id,
      targetKey,
      token: `stale-after-${deployment.id}`,
      expiresAt: Date.now() - 1000
    })

    const doubles = installRecoveryDoubles(sails)
    try {
      const result = await sails.helpers.deploy.reconcileDeployments()

      expect(result.recovered).toEqual([
        { deploymentId: deployment.id, action: 'finalized' }
      ])
      const [recoveredDeployment, recoveredJob, previousDeployment] =
        await Promise.all([
          sails.models.deployment.findOne({ id: deployment.id }),
          sails.models.deploymentjob.findOne({ id: job.id }),
          sails.models.deployment.findOne({ id: previous.id })
        ])
      expect(recoveredDeployment.status).toBe('running')
      expect(recoveredJob.stage).toBe('complete')
      expect(previousDeployment.status).toBe('stopped')
      expect(doubles.stopped).toEqual(['stable-after'])
      expect(doubles.removedImages).toEqual([])
      expect(doubles.routes).toEqual([current.environments.production.id])
      expect(doubles.routeCleanups).toEqual(['after-repair'])
    } finally {
      doubles.restore()
    }
  }
)

test(
  'a worker that loses its lease rolls back a staged route before App commit',
  { world: deploymentWorld('fenced-cutover') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const previous = await world.create('deployment').with({
      status: 'running',
      environment: current.environments.production.id,
      app: current.apps.web.id,
      imageName: 'slipway/fenced:1'
    })
    const app = await sails.models.app
      .updateOne({ id: current.apps.web.id })
      .set({
        status: 'running',
        containerName: 'stable-fenced',
        imageName: previous.imageName,
        port: 1337,
        hostPort: 1443,
        currentDeployment: previous.id
      })
    const deployment = await world.create('deployment').with({
      status: 'deploying',
      environment: current.environments.production.id,
      app: app.id,
      imageName: 'slipway/fenced:2'
    })
    const targetKey = `environment:${current.environments.production.id}`
    const token = `fenced-${deployment.id}`
    await world.create('deploymentlease').with({
      deployment: deployment.id,
      targetKey,
      token,
      heartbeatAt: Date.now(),
      expiresAt: Date.now() + 30_000
    })

    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const originalFinishRouteUpdate = sails.helpers.caddy.finishRouteUpdate
    const originalAssertLease = sails.helpers.deploy.assertDeploymentLease
    const finishActions = []
    let leaseChecks = 0
    sails.helpers.deploy.assertDeploymentLease = {
      with: async () => {
        leaseChecks += 1
        return leaseChecks === 1
          ? { valid: true }
          : {
              valid: false,
              code: 'DEPLOYMENT_LEASE_LOST',
              message: `Deployment ${deployment.id} no longer owns its pipeline lease.`
            }
      }
    }
    sails.helpers.caddy.updateRoute = {
      with: async () => ({
        action: 'replaced',
        transaction: {
          routeId: 'fenced-route',
          candidateRouteId: 'fenced-route-candidate',
          previousRouteId: 'fenced-route-previous'
        }
      })
    }
    sails.helpers.caddy.finishRouteUpdate = {
      with: async ({ action }) => finishActions.push(action)
    }

    try {
      const error = await captureError(
        sails.helpers.deploy.cutoverTraffic.with({
          deploymentId: deployment.id,
          leaseToken: token,
          environmentId: current.environments.production.id,
          appId: app.id,
          candidate: {
            containerId: 'candidate-fenced-id',
            containerName: 'candidate-fenced',
            imageName: deployment.imageName,
            port: 1337,
            hostPort: 1444,
            slug: app.slug,
            name: app.name,
            routePath: app.routePath,
            healthPath: app.healthPath,
            isDefault: app.isDefault
          }
        })
      )
      const persistedApp = await sails.models.app.findOne({ id: app.id })

      expect(Boolean(error)).toBe(true)
      expect(leaseChecks).toBe(2)
      expect(finishActions).toEqual(['rollback'])
      expect(persistedApp.containerName).toBe('stable-fenced')
      expect(persistedApp.currentDeployment).toBe(previous.id)
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
      sails.helpers.caddy.finishRouteUpdate = originalFinishRouteUpdate
      sails.helpers.deploy.assertDeploymentLease = originalAssertLease
    }
  }
)

function installRecoveryDoubles(sails) {
  const originals = {
    updateRoute: sails.helpers.caddy.updateRoute,
    stopContainer: sails.helpers.docker.stopContainer,
    releasePort: sails.helpers.docker.releasePort,
    removeImage: sails.helpers.docker.removeImage,
    cleanupRouteTransaction: sails.helpers.caddy.cleanupRouteTransaction
  }
  const routes = []
  const stopped = []
  const removedImages = []
  const routeCleanups = []

  sails.helpers.caddy.updateRoute = {
    with: async ({ environmentId }) => routes.push(environmentId)
  }
  sails.helpers.caddy.cleanupRouteTransaction = {
    with: async ({ phase }) => routeCleanups.push(phase)
  }
  sails.helpers.docker.stopContainer = {
    with: async ({ containerName }) => stopped.push(containerName)
  }
  sails.helpers.docker.releasePort = { with: async () => ({ released: 1 }) }
  sails.helpers.docker.removeImage = {
    with: async ({ imageName }) => removedImages.push(imageName)
  }

  return {
    routes,
    stopped,
    removedImages,
    routeCleanups,
    restore() {
      sails.helpers.caddy.updateRoute = originals.updateRoute
      sails.helpers.caddy.cleanupRouteTransaction =
        originals.cleanupRouteTransaction
      sails.helpers.docker.stopContainer = originals.stopContainer
      sails.helpers.docker.releasePort = originals.releasePort
      sails.helpers.docker.removeImage = originals.removeImage
    }
  }
}

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error('Expected operation to fail.')
}
