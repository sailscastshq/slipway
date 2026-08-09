const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '../../../../')

function deploymentWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: { slug }
    }
  }
}

test(
  'candidate preparation starts normally when its Docker name is free',
  { world: deploymentWorld('candidate-name-ready') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      environment: current.environments.production.id,
      app: current.apps.web.id
    })
    const doubles = installContainerDoubles(sails, { status: null })

    try {
      const result = await sails.helpers.deploy.prepareCandidateContainer.with({
        deploymentId: String(deployment.id),
        appId: String(current.apps.web.id),
        containerName: 'candidate-ready'
      })

      expect(result).toEqual({ action: 'ready' })
      expect(doubles.statusChecks).toEqual([
        { containerName: 'candidate-ready', fresh: true }
      ])
      expect(doubles.stopped).toEqual([])
    } finally {
      doubles.restore()
    }
  }
)

test(
  'candidate preparation removes an uncommitted leftover before retry',
  { world: deploymentWorld('candidate-name-stale') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      environment: current.environments.production.id,
      app: current.apps.web.id,
      deployLogs: ''
    })
    const status = { running: true, status: 'running' }
    const doubles = installContainerDoubles(sails, { status })

    try {
      const result = await sails.helpers.deploy.prepareCandidateContainer.with({
        deploymentId: String(deployment.id),
        appId: String(current.apps.web.id),
        containerName: 'candidate-stale'
      })
      const persisted = await sails.models.deployment.findOne({
        id: deployment.id
      })

      expect(result).toEqual({ action: 'removed', status })
      expect(doubles.stopped).toEqual(['candidate-stale'])
      expect(persisted.deployLogs).toContain(
        'Removed stale candidate container before retry: candidate-stale'
      )
    } finally {
      doubles.restore()
    }
  }
)

test(
  'candidate preparation cannot remove a leftover after its lease expires',
  { world: deploymentWorld('candidate-name-fenced') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      environment: current.environments.production.id,
      app: current.apps.web.id
    })
    const token = `expired-${deployment.id}`
    await world.create('deploymentlease').with({
      deployment: deployment.id,
      targetKey: `environment:${current.environments.production.id}`,
      token,
      expiresAt: Date.now() - 1
    })
    const doubles = installContainerDoubles(sails, {
      status: { running: true, status: 'running' }
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.prepareCandidateContainer.with({
          deploymentId: String(deployment.id),
          leaseToken: token,
          appId: String(current.apps.web.id),
          containerName: 'candidate-fenced'
        })
      )

      expect(error.code).toBe('DEPLOYMENT_LEASE_LOST')
      expect(doubles.statusChecks).toEqual([])
      expect(doubles.stopped).toEqual([])
    } finally {
      doubles.restore()
    }
  }
)

test(
  'candidate preparation protects the committed container that owns traffic',
  { world: deploymentWorld('candidate-name-current') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      status: 'deploying',
      environment: current.environments.production.id,
      app: current.apps.web.id
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'candidate-current',
      currentDeployment: deployment.id
    })
    const status = { running: true, status: 'running' }
    const doubles = installContainerDoubles(sails, { status })

    try {
      const result = await sails.helpers.deploy.prepareCandidateContainer.with({
        deploymentId: String(deployment.id),
        appId: String(current.apps.web.id),
        containerName: 'candidate-current'
      })

      expect(result.action).toBe('current')
      expect(result.status).toEqual(status)
      expect(doubles.stopped).toEqual([])
    } finally {
      doubles.restore()
    }
  }
)

test('deploy and rollback reconcile candidate names before docker run', async ({
  expect
}) => {
  for (const relativePath of [
    'api/helpers/deploy/execute-pipeline.js',
    'api/helpers/deploy/execute-rollback.js'
  ]) {
    const source = fs.readFileSync(path.join(appRoot, relativePath), 'utf8')
    const preparation = source.indexOf(
      'await sails.helpers.deploy.prepareCandidateContainer.with({'
    )
    const run = source.indexOf('await sails.helpers.docker.runContainer.with({')

    expect(preparation > -1).toBe(true)
    expect(run > -1).toBe(true)
    expect(preparation < run).toBe(true)
  }
})

test(
  'candidate preparation refuses to remove an inconsistent traffic owner',
  { world: deploymentWorld('candidate-name-traffic-owner') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      status: 'deploying',
      environment: current.environments.production.id,
      app: current.apps.web.id
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'candidate-owner',
      currentDeployment: null
    })
    const doubles = installContainerDoubles(sails, {
      status: { running: true, status: 'running' }
    })

    try {
      const result = await sails.helpers.deploy.prepareCandidateContainer.with({
        deploymentId: String(deployment.id),
        appId: String(current.apps.web.id),
        containerName: 'candidate-owner'
      })

      expect(result.action).toBe('traffic-owner-conflict')
      expect(doubles.stopped).toEqual([])
    } finally {
      doubles.restore()
    }
  }
)

test(
  'an already committed candidate is finalized without starting another container',
  { world: deploymentWorld('candidate-name-finalize') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const previous = await world.create('deployment').with({
      status: 'running',
      environment: current.environments.production.id,
      app: current.apps.web.id
    })
    const deployment = await world.create('deployment').with({
      status: 'deploying',
      environment: current.environments.production.id,
      app: current.apps.web.id
    })
    const job = await world.create('deploymentjob').with({
      deployment: deployment.id,
      targetKey: `environment:${current.environments.production.id}`,
      stage: 'container_startup',
      previousContainerName: 'candidate-previous',
      hostPort: 1499
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'candidate-finalized',
      currentDeployment: deployment.id
    })

    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const originalStopContainer = sails.helpers.docker.stopContainer
    const originalReleasePort = sails.helpers.docker.releasePort
    const routes = []
    const stopped = []
    const released = []
    sails.helpers.caddy.updateRoute = {
      with: async ({ environmentId }) => routes.push(environmentId)
    }
    sails.helpers.docker.stopContainer = {
      with: async ({ containerName }) => stopped.push(containerName)
    }
    sails.helpers.docker.releasePort = {
      with: async (inputs) => released.push(inputs)
    }

    try {
      await sails.helpers.deploy.finalizeCurrentCandidate.with({
        deploymentId: String(deployment.id),
        environmentId: String(current.environments.production.id),
        appId: String(current.apps.web.id)
      })

      const [persisted, persistedPrevious, persistedJob] = await Promise.all([
        sails.models.deployment.findOne({ id: deployment.id }),
        sails.models.deployment.findOne({ id: previous.id }),
        sails.models.deploymentjob.findOne({ id: job.id })
      ])
      expect(persisted.status).toBe('running')
      expect(persistedPrevious.status).toBe('stopped')
      expect(persistedJob.stage).toBe('complete')
      expect(routes).toEqual([String(current.environments.production.id)])
      expect(stopped).toEqual(['candidate-previous'])
      expect(released).toEqual([
        {
          hostPort: 1499,
          ownerType: 'deployment',
          ownerId: String(deployment.id)
        }
      ])
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
      sails.helpers.docker.stopContainer = originalStopContainer
      sails.helpers.docker.releasePort = originalReleasePort
    }
  }
)

function installContainerDoubles(sails, { status }) {
  const originals = {
    getContainerStatus: sails.helpers.docker.getContainerStatus,
    stopContainer: sails.helpers.docker.stopContainer
  }
  const statusChecks = []
  const stopped = []

  sails.helpers.docker.getContainerStatus = {
    with: async (inputs) => {
      statusChecks.push(inputs)
      if (!status) throw 'notFound'
      return status
    }
  }
  sails.helpers.docker.stopContainer = {
    with: async ({ containerName }) => {
      stopped.push(containerName)
      return { stopped: true, removed: true }
    }
  }

  return {
    statusChecks,
    stopped,
    restore() {
      sails.helpers.docker.getContainerStatus = originals.getContainerStatus
      sails.helpers.docker.stopContainer = originals.stopContainer
    }
  }
}

async function captureError(promise) {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}
