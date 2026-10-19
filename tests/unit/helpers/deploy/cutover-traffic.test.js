const { test } = require('sounding')

function cutoverWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: {
        slug,
        name: 'Transactional Cutover'
      }
    }
  }
}

async function prepareCutover({ sails, world }) {
  const current = world.current
  const app = current.apps.web
  const previousDeployment = await world.create('deployment').with({
    status: 'running',
    imageName: 'slipway/web:previous',
    environment: current.environments.production.id,
    app: app.id,
    triggeredBy: current.users.genesisUser.id
  })
  const previousApp = await sails.models.app.updateOne({ id: app.id }).set({
    status: 'running',
    containerId: 'previous-container-id',
    containerName: 'slipway-web-previous',
    imageName: previousDeployment.imageName,
    port: 1337,
    hostPort: 1401,
    currentDeployment: previousDeployment.id
  })
  const deployment = await world.create('deployment').with({
    status: 'deploying',
    imageName: 'slipway/web:candidate',
    environment: current.environments.production.id,
    app: app.id,
    triggeredBy: current.users.genesisUser.id
  })

  return {
    app: previousApp,
    candidate: {
      containerId: 'candidate-container-id',
      containerName: 'slipway-web-candidate',
      imageName: deployment.imageName,
      port: 1337,
      hostPort: 1402,
      slug: previousApp.slug,
      name: previousApp.name,
      healthPath: previousApp.healthPath,
      routePath: previousApp.routePath,
      isDefault: previousApp.isDefault
    },
    deployment,
    environment: current.environments.production
  }
}

async function prepareRollback({ sails, setup, world }) {
  const recovery = require('../../../../api/lib/deployment-recovery')
  const image = (n) => 'sha256:' + String(n).padStart(64, '0')
  const target = await world.create('deployment').with({
    status: 'stopped',
    imageName: 'slipway/web:healthy',
    imageId: image(1),
    finishedAt: Date.now() - 1000,
    environment: setup.environment.id,
    app: setup.app.id
  })
  await sails.models.deployment
    .updateOne({ id: setup.app.currentDeployment })
    .set({ imageId: image(2) })
  setup.app = await sails.models.app
    .updateOne({ id: setup.app.id })
    .set({ imageId: image(2) })
  const state = recovery.parse(
    {
      version: 1,
      appId: String(setup.app.id),
      environmentId: String(setup.environment.id),
      current: {
        deploymentId: String(setup.app.currentDeployment),
        imageId: image(2),
        compatibility: 'schema-1',
        promotedAt: Date.now()
      },
      previous: {
        deploymentId: String(target.id),
        imageId: image(1),
        compatibility: 'schema-1',
        promotedAt: Date.now() - 1000
      },
      rejectedImages: []
    },
    setup.app
  )
  await sails.models.setting.create({
    key: recovery.key(setup.app.id),
    value: JSON.stringify(state)
  })
  await sails.models.setting.create({
    key: `rollbackIntent:v1:${setup.deployment.id}`,
    value: JSON.stringify({
      appId: setup.app.id,
      environmentId: setup.environment.id,
      expectedCurrent: String(setup.app.currentDeployment),
      targetDeploymentId: target.id,
      imageId: image(1),
      compatibility: 'schema-1'
    })
  })
  await sails.models.deploymentjob.create({
    deployment: setup.deployment.id,
    targetKey: `environment:${setup.environment.id}`,
    kind: 'rollback',
    targetDeploymentId: target.id
  })
  return target
}

function machineStub(fn) {
  fn.with = fn
  return fn
}

function stagedRoute(action = 'replaced') {
  return {
    action,
    transaction: {
      routeId: 'slipway-route-test',
      candidateRouteId: 'slipway-route-test-candidate',
      previousRouteId: 'slipway-route-test-previous'
    }
  }
}

test(
  'traffic cutover verifies the candidate route before committing App state',
  { world: cutoverWorld('cutover-success') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const originalFinishRouteUpdate = sails.helpers.caddy.finishRouteUpdate
    const calls = []
    const finishCalls = []

    sails.helpers.caddy.updateRoute = machineStub(async (inputs) => {
      calls.push(inputs)
      const persisted = await sails.models.app.findOne({ id: setup.app.id })
      expect(persisted.containerName).toBe('slipway-web-previous')
      expect(
        inputs.apps.find((app) => app.id === setup.app.id).containerName
      ).toBe('slipway-web-candidate')
      return stagedRoute()
    })
    sails.helpers.caddy.finishRouteUpdate = machineStub(async (inputs) => {
      finishCalls.push(inputs)
      const persisted = await sails.models.app.findOne({ id: setup.app.id })
      expect(persisted.containerName).toBe('slipway-web-candidate')
      return { action: 'committed' }
    })

    try {
      const result = await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: setup.deployment.id,
        environmentId: setup.environment.id,
        appId: setup.app.id,
        candidate: setup.candidate
      })

      const app = await sails.models.app.findOne({ id: setup.app.id })
      const actions = (
        await sails.models.auditlog.find({ resourceId: setup.deployment.id })
      ).map((event) => event.action)

      expect(calls.length).toBe(1)
      expect(calls[0].deferCommit).toBe(true)
      expect(finishCalls.map(({ action }) => action)).toEqual(['commit'])
      expect(result.previousApp.containerName).toBe('slipway-web-previous')
      expect(app.containerName).toBe('slipway-web-candidate')
      expect(app.hostPort).toBe(1402)
      expect(app.currentDeployment).toBe(setup.deployment.id)
      expect(actions).toEqual([
        'deployment.cutover.started',
        'deployment.cutover.succeeded'
      ])
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
      sails.helpers.caddy.finishRouteUpdate = originalFinishRouteUpdate
    }
  }
)

test(
  'first deployment stages a root route before creating its App record',
  { world: cutoverWorld('cutover-first-deployment') },
  async ({ sails, world, expect }) => {
    const environment = world.current.environments.production
    await sails.models.app.destroy({ environment: environment.id })
    const deployment = await world.create('deployment').with({
      status: 'deploying',
      imageName: 'slipway/web:first',
      environment: environment.id,
      triggeredBy: world.current.users.genesisUser.id
    })
    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const originalFinishRouteUpdate = sails.helpers.caddy.finishRouteUpdate
    let stagedApp

    sails.helpers.caddy.updateRoute = machineStub(async ({ apps }) => {
      stagedApp = apps[0]
      const persistedApps = await sails.models.app.find({
        environment: environment.id
      })
      expect(persistedApps.length).toBe(0)
      return stagedRoute('created')
    })
    sails.helpers.caddy.finishRouteUpdate = machineStub(async () => ({
      action: 'committed'
    }))

    try {
      const result = await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: deployment.id,
        environmentId: environment.id,
        candidate: {
          containerId: 'first-container-id',
          containerName: 'slipway-web-first',
          imageName: deployment.imageName,
          port: 1337,
          hostPort: 1400
        }
      })

      expect(stagedApp.routePath).toBe('/')
      expect(stagedApp.healthPath).toBe('/health')
      expect(result.app.containerName).toBe('slipway-web-first')
      expect(result.app.routePath).toBe('/')
      expect(result.app.isDefault).toBe(true)
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
      sails.helpers.caddy.finishRouteUpdate = originalFinishRouteUpdate
    }
  }
)

test(
  'failed first App commit removes the candidate route and leaves no partial App state',
  { world: cutoverWorld('cutover-first-deployment-failure') },
  async ({ sails, world, expect }) => {
    const environment = world.current.environments.production
    await sails.models.app.destroy({ environment: environment.id })
    const deployment = await world.create('deployment').with({
      status: 'deploying',
      imageName: 'slipway/web:first-failure',
      environment: environment.id,
      triggeredBy: world.current.users.genesisUser.id
    })
    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const originalFinishRouteUpdate = sails.helpers.caddy.finishRouteUpdate
    const routeCalls = []
    const finishActions = []

    sails.helpers.caddy.updateRoute = machineStub(async (inputs) => {
      routeCalls.push(inputs)
      return stagedRoute('created')
    })
    sails.helpers.caddy.finishRouteUpdate = machineStub(async ({ action }) => {
      finishActions.push(action)
      return { action: 'rolled_back' }
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.cutoverTraffic.with({
          deploymentId: deployment.id,
          environmentId: environment.id,
          candidate: {
            containerId: 'first-failed-container-id',
            containerName: 'slipway-web-first-failure',
            imageName: deployment.imageName,
            port: 1337,
            hostPort: 'not-a-port'
          }
        })
      )
      const apps = await sails.models.app.find({ environment: environment.id })
      const actions = (
        await sails.models.auditlog.find({ resourceId: deployment.id })
      ).map((event) => event.action)

      expect(error.message).toContain('was rolled back')
      expect(apps.length).toBe(0)
      expect(routeCalls.length).toBe(1)
      expect(routeCalls[0].apps[0].containerName).toBe(
        'slipway-web-first-failure'
      )
      expect(finishActions).toEqual(['rollback'])
      expect(actions).toEqual([
        'deployment.cutover.started',
        'deployment.cutover.failed',
        'deployment.cutover.rolled_back'
      ])
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
      sails.helpers.caddy.finishRouteUpdate = originalFinishRouteUpdate
    }
  }
)

test(
  'Caddy update failure preserves the previous App and records a rollback',
  { world: cutoverWorld('cutover-caddy-failure') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const failure = new Error('Caddy route container could not be created')
    failure.code = 'CADDY_ROUTE_APPLY_FAILED'
    sails.helpers.caddy.updateRoute = machineStub(async () => {
      throw failure
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.cutoverTraffic.with({
          deploymentId: setup.deployment.id,
          environmentId: setup.environment.id,
          appId: setup.app.id,
          candidate: setup.candidate
        })
      )
      const app = await sails.models.app.findOne({ id: setup.app.id })
      const actions = (
        await sails.models.auditlog.find({ resourceId: setup.deployment.id })
      ).map((event) => event.action)

      expect(error.message).toContain('was rolled back')
      expect(app.containerName).toBe('slipway-web-previous')
      expect(app.hostPort).toBe(1401)
      expect(actions).toEqual([
        'deployment.cutover.started',
        'deployment.cutover.failed',
        'deployment.cutover.rolled_back'
      ])
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
    }
  }
)

test(
  'route verification failure never commits the candidate App state',
  { world: cutoverWorld('cutover-verification-failure') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const failure = new Error('Candidate upstream never appeared in Caddy')
    failure.code = 'CADDY_ROUTE_VERIFICATION_FAILED'
    sails.helpers.caddy.updateRoute = machineStub(async () => {
      throw failure
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.cutoverTraffic.with({
          deploymentId: setup.deployment.id,
          environmentId: setup.environment.id,
          appId: setup.app.id,
          candidate: setup.candidate
        })
      )
      const app = await sails.models.app.findOne({ id: setup.app.id })
      const deployment = await sails.models.deployment.findOne({
        id: setup.deployment.id
      })

      expect(error.message).toContain('Candidate upstream never appeared')
      expect(app.containerName).toBe('slipway-web-previous')
      expect(deployment.deployLogs).toContain(
        'the previous route and container remain active'
      )
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
    }
  }
)

test(
  'route restoration failure is explicit and leaves previous App state intact',
  { world: cutoverWorld('cutover-rollback-failure') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const originalFinishRouteUpdate = sails.helpers.caddy.finishRouteUpdate
    let routeCalls = 0
    sails.helpers.caddy.updateRoute = machineStub(async () => {
      routeCalls += 1
      return stagedRoute()
    })
    sails.helpers.caddy.finishRouteUpdate = machineStub(async ({ action }) => {
      if (action === 'rollback') {
        throw new Error('Previous route could not be restored')
      }
      return { action: 'committed' }
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.cutoverTraffic.with({
          deploymentId: setup.deployment.id,
          environmentId: setup.environment.id,
          appId: setup.app.id,
          candidate: {
            ...setup.candidate,
            hostPort: 'not-a-port'
          }
        })
      )
      const app = await sails.models.app.findOne({ id: setup.app.id })
      const actions = (
        await sails.models.auditlog.find({ resourceId: setup.deployment.id })
      ).map((event) => event.action)

      expect(routeCalls).toBe(1)
      expect(error.message).toContain('Cutover rollback also failed')
      expect(error.message).toContain('Previous route could not be restored')
      expect(app.containerName).toBe('slipway-web-previous')
      expect(app.hostPort).toBe(1401)
      expect(actions).toContain('deployment.cutover.rollback_failed')
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
      sails.helpers.caddy.finishRouteUpdate = originalFinishRouteUpdate
    }
  }
)

test(
  'route finalization failure restores the App record committed during cutover',
  { world: cutoverWorld('cutover-finalization-failure') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    const originalFinishRouteUpdate = sails.helpers.caddy.finishRouteUpdate
    const finishActions = []
    sails.helpers.caddy.updateRoute = machineStub(async () => stagedRoute())
    sails.helpers.caddy.finishRouteUpdate = machineStub(async ({ action }) => {
      finishActions.push(action)
      if (action === 'commit') {
        const persisted = await sails.models.app.findOne({ id: setup.app.id })
        expect(persisted.containerName).toBe('slipway-web-candidate')
        throw new Error('Candidate-only route could not be finalized')
      }
      return { action: 'rolled_back' }
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.cutoverTraffic.with({
          deploymentId: setup.deployment.id,
          environmentId: setup.environment.id,
          appId: setup.app.id,
          candidate: setup.candidate
        })
      )
      const app = await sails.models.app.findOne({ id: setup.app.id })

      expect(error.message).toContain('was rolled back')
      expect(finishActions).toEqual(['commit', 'rollback'])
      expect(app.containerName).toBe('slipway-web-previous')
      expect(app.hostPort).toBe(1401)
      expect(app.currentDeployment).toBe(setup.app.currentDeployment)
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
      sails.helpers.caddy.finishRouteUpdate = originalFinishRouteUpdate
    }
  }
)

test(
  'worker cutover commits state without mutating Caddy routes',
  { world: cutoverWorld('cutover-worker') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const originalUpdateRoute = sails.helpers.caddy.updateRoute
    let routeCalls = 0
    sails.helpers.caddy.updateRoute = machineStub(async () => {
      routeCalls += 1
      throw new Error('Worker cutover must not touch Caddy')
    })

    try {
      const result = await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: setup.deployment.id,
        environmentId: setup.environment.id,
        appId: setup.app.id,
        candidate: { ...setup.candidate, routePath: null }
      })
      const app = await sails.models.app.findOne({ id: setup.app.id })

      expect(routeCalls).toBe(0)
      expect(result.route).toEqual({ action: 'unchanged', reason: 'worker' })
      expect(app.containerName).toBe('slipway-web-candidate')
      expect(app.routePath).toBe(null)
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdateRoute
    }
  }
)

test(
  'cancellation before cutover removes the candidate release and preserves the live app',
  { world: cutoverWorld('cancel-before-cutover') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const originals = {
      inspectDeploymentImage: sails.helpers.docker.inspectDeploymentImage,
      ensureNetwork: sails.helpers.docker.ensureNetwork,
      prepareCandidateContainer: sails.helpers.deploy.prepareCandidateContainer,
      ensureBuildContext: sails.helpers.deploy.ensureBuildContext,
      buildImage: sails.helpers.docker.buildImage,
      detectFeatures: sails.helpers.sails.detectFeatures,
      allocatePort: sails.helpers.docker.allocatePort,
      runContainer: sails.helpers.docker.runContainer,
      healthCheck: sails.helpers.docker.healthCheck,
      captureStartupDiagnostics: sails.helpers.docker.captureStartupDiagnostics,
      cutoverTraffic: sails.helpers.deploy.cutoverTraffic,
      releasePort: sails.helpers.docker.releasePort,
      stopContainer: sails.helpers.docker.stopContainer,
      removeImage: sails.helpers.docker.removeImage
    }
    const controller = new AbortController()
    const cancellation = new Error('Cancelled by Builder')
    cancellation.code = 'DEPLOYMENT_CANCELLED'
    const sequence = []
    let candidateName
    let candidateImage

    sails.helpers.docker.captureStartupDiagnostics = machineStub(async () => ({
      captured: true
    }))
    sails.helpers.docker.inspectDeploymentImage = machineStub(
      async ({ imageReference }) => ({
        imageId: imageReference.startsWith('sha256:')
          ? imageReference
          : 'sha256:' + '4'.padStart(64, '0'),
        compatibility: 'schema-1'
      })
    )
    sails.helpers.docker.ensureNetwork = machineStub(async () => {})
    sails.helpers.deploy.prepareCandidateContainer = machineStub(async () => ({
      action: 'ready'
    }))
    sails.helpers.deploy.ensureBuildContext = machineStub(async () => ({
      contextPath: '/tmp/slipway-cancel-before-cutover'
    }))
    sails.helpers.docker.buildImage = machineStub(async ({ imageName }) => {
      candidateImage = imageName
      sequence.push('image-built')
    })
    sails.helpers.sails.detectFeatures = machineStub(async () => ({}))
    sails.helpers.docker.allocatePort = machineStub(async () => 1405)
    sails.helpers.docker.runContainer = machineStub(async (inputs) => {
      candidateName = inputs.containerName
      sequence.push(`started:${candidateName}`)
      return {
        containerId: 'cancelled-candidate-id',
        containerName: candidateName,
        hostPort: inputs.hostPort,
        portBinding: { diagnostic: 'verified' }
      }
    })
    sails.helpers.docker.healthCheck = machineStub(async ({ signal }) => {
      sequence.push('health-check-started')
      await sails.models.deployment.updateOne({ id: setup.deployment.id }).set({
        status: 'cancelled',
        errorMessage: cancellation.message,
        finishedAt: Date.now()
      })
      controller.abort(cancellation)
      throw signal.reason
    })
    sails.helpers.deploy.cutoverTraffic = machineStub(async () => {
      sequence.push('cutover')
    })
    sails.helpers.docker.stopContainer = machineStub(
      async ({ containerName }) => {
        sequence.push(`stopped:${containerName}`)
      }
    )
    sails.helpers.docker.releasePort = machineStub(async () => {
      sequence.push('port-released')
      return { released: 1 }
    })
    sails.helpers.docker.removeImage = machineStub(async ({ imageName }) => {
      sequence.push(`removed:${imageName}`)
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.executePipeline.with({
          deploymentId: setup.deployment.id,
          project: world.current.projects.deploymentTarget,
          environment: setup.environment,
          app: setup.app,
          signal: controller.signal
        })
      )
      const [app, deployment] = await Promise.all([
        sails.models.app.findOne({ id: setup.app.id }),
        sails.models.deployment.findOne({ id: setup.deployment.id })
      ])

      expect(error.code).toBe('DEPLOYMENT_CANCELLED')
      expect(deployment.status).toBe('cancelled')
      expect(app.containerName).toBe('slipway-web-previous')
      expect(app.hostPort).toBe(1401)
      expect(sequence).toEqual([
        'image-built',
        `started:${candidateName}`,
        'health-check-started',
        `stopped:${candidateName}`,
        'port-released',
        `removed:${candidateImage}`
      ])
      expect(deployment.deployLogs).toContain(
        'Cancellation acknowledged during health check'
      )
    } finally {
      sails.helpers.docker.inspectDeploymentImage =
        originals.inspectDeploymentImage
      sails.helpers.docker.ensureNetwork = originals.ensureNetwork
      sails.helpers.deploy.prepareCandidateContainer =
        originals.prepareCandidateContainer
      sails.helpers.deploy.ensureBuildContext = originals.ensureBuildContext
      sails.helpers.docker.buildImage = originals.buildImage
      sails.helpers.sails.detectFeatures = originals.detectFeatures
      sails.helpers.docker.allocatePort = originals.allocatePort
      sails.helpers.docker.runContainer = originals.runContainer
      sails.helpers.docker.healthCheck = originals.healthCheck
      sails.helpers.docker.captureStartupDiagnostics =
        originals.captureStartupDiagnostics
      sails.helpers.deploy.cutoverTraffic = originals.cutoverTraffic
      sails.helpers.docker.releasePort = originals.releasePort
      sails.helpers.docker.stopContainer = originals.stopContainer
      sails.helpers.docker.removeImage = originals.removeImage
    }
  }
)

test(
  'rollback uses a deployment-scoped candidate and retires the old container only after cutover',
  { world: cutoverWorld('transactional-rollback') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const previousDeployment = await prepareRollback({ sails, setup, world })
    const originals = {
      inspectDeploymentImage: sails.helpers.docker.inspectDeploymentImage,
      ensureNetwork: sails.helpers.docker.ensureNetwork,
      prepareCandidateContainer: sails.helpers.deploy.prepareCandidateContainer,
      allocatePort: sails.helpers.docker.allocatePort,
      runContainer: sails.helpers.docker.runContainer,
      healthCheck: sails.helpers.docker.healthCheck,
      captureStartupDiagnostics: sails.helpers.docker.captureStartupDiagnostics,
      releasePort: sails.helpers.docker.releasePort,
      stopContainer: sails.helpers.docker.stopContainer,
      getServerIp: sails.helpers.getServerIp,
      getDirectAccess: sails.helpers.deploy.getDirectAccess,
      updateRoute: sails.helpers.caddy.updateRoute,
      finishRouteUpdate: sails.helpers.caddy.finishRouteUpdate
    }
    const sequence = []
    let candidateName

    sails.helpers.docker.captureStartupDiagnostics = machineStub(async () => ({
      captured: true
    }))
    sails.helpers.docker.inspectDeploymentImage = machineStub(
      async ({ imageReference }) => ({
        imageId: imageReference.startsWith('sha256:')
          ? imageReference
          : 'sha256:' + '4'.padStart(64, '0'),
        compatibility: 'schema-1'
      })
    )
    sails.helpers.docker.ensureNetwork = machineStub(async () => {})
    sails.helpers.deploy.prepareCandidateContainer = machineStub(async () => ({
      action: 'ready'
    }))
    sails.helpers.docker.allocatePort = machineStub(async () => 1403)
    sails.helpers.docker.runContainer = machineStub(async (inputs) => {
      expect(inputs.imageName).toBe(previousDeployment.imageId)
      expect(inputs.pullPolicy).toBe('never')
      sequence.push('candidate-started')
      candidateName = inputs.containerName
      return {
        containerId: 'rollback-container-id',
        containerName: inputs.containerName,
        hostPort: inputs.hostPort,
        portBinding: { diagnostic: 'verified' }
      }
    })
    sails.helpers.docker.healthCheck = machineStub(async () => {
      sequence.push('candidate-healthy')
    })
    sails.helpers.caddy.updateRoute = machineStub(async (inputs) => {
      sequence.push('route-verified')
      const persisted = await sails.models.app.findOne({ id: setup.app.id })
      expect(persisted.containerName).toBe('slipway-web-previous')
      expect(
        inputs.apps.find((app) => app.id === setup.app.id).containerName
      ).toBe(candidateName)
      return stagedRoute()
    })
    sails.helpers.caddy.finishRouteUpdate = machineStub(async ({ action }) => {
      sequence.push('route-finalized')
      const persisted = await sails.models.app.findOne({ id: setup.app.id })
      expect(action).toBe('commit')
      expect(persisted.containerName).toBe(candidateName)
      return { action: 'committed' }
    })
    sails.helpers.docker.releasePort = machineStub(async () => {
      sequence.push('port-released')
      return { released: 1 }
    })
    sails.helpers.docker.stopContainer = machineStub(async (inputs) => {
      sequence.push(`stopped:${inputs.containerName}`)
    })
    sails.helpers.getServerIp = machineStub(async () => '127.0.0.1')
    sails.helpers.deploy.getDirectAccess = machineStub(async () => ({
      url: null,
      message: null
    }))

    try {
      await sails.helpers.deploy.executeRollback.with({
        rollbackId: setup.deployment.id,
        targetDeployment: previousDeployment,
        environment: setup.environment,
        app: setup.app
      })

      const app = await sails.models.app.findOne({ id: setup.app.id })
      const rollback = await sails.models.deployment.findOne({
        id: setup.deployment.id
      })

      expect(candidateName).toContain(String(setup.deployment.id))
      expect(candidateName === 'slipway-web-previous').toBe(false)
      expect(app.containerName).toBe(candidateName)
      expect(rollback.status).toBe('running')
      const recovery = require('../../../../api/lib/deployment-recovery')
      const retained = JSON.parse(
        (await sails.models.setting.findOne({ key: recovery.key(app.id) }))
          .value
      )
      expect(retained.current.deploymentId).toBe(String(rollback.id))
      expect(retained.current.imageId).toBe(previousDeployment.imageId)
      expect(retained.previous).toBe(null)
      expect(retained.rejectedImages).toContain(setup.app.imageId)

      expect(sequence).toEqual([
        'candidate-started',
        'candidate-healthy',
        'route-verified',
        'route-finalized',
        'port-released',
        'stopped:slipway-web-previous'
      ])
    } finally {
      sails.helpers.docker.inspectDeploymentImage =
        originals.inspectDeploymentImage
      sails.helpers.docker.ensureNetwork = originals.ensureNetwork
      sails.helpers.deploy.prepareCandidateContainer =
        originals.prepareCandidateContainer
      sails.helpers.docker.allocatePort = originals.allocatePort
      sails.helpers.docker.runContainer = originals.runContainer
      sails.helpers.docker.healthCheck = originals.healthCheck
      sails.helpers.docker.captureStartupDiagnostics =
        originals.captureStartupDiagnostics
      sails.helpers.docker.releasePort = originals.releasePort
      sails.helpers.docker.stopContainer = originals.stopContainer
      sails.helpers.getServerIp = originals.getServerIp
      sails.helpers.deploy.getDirectAccess = originals.getDirectAccess
      sails.helpers.caddy.updateRoute = originals.updateRoute
      sails.helpers.caddy.finishRouteUpdate = originals.finishRouteUpdate
    }
  }
)

test(
  'rollback failure removes only the candidate and keeps the previous app live',
  { world: cutoverWorld('transactional-rollback-failure') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const previousDeployment = await prepareRollback({ sails, setup, world })
    const originals = {
      inspectDeploymentImage: sails.helpers.docker.inspectDeploymentImage,
      ensureNetwork: sails.helpers.docker.ensureNetwork,
      prepareCandidateContainer: sails.helpers.deploy.prepareCandidateContainer,
      allocatePort: sails.helpers.docker.allocatePort,
      runContainer: sails.helpers.docker.runContainer,
      healthCheck: sails.helpers.docker.healthCheck,
      captureStartupDiagnostics: sails.helpers.docker.captureStartupDiagnostics,
      releasePort: sails.helpers.docker.releasePort,
      stopContainer: sails.helpers.docker.stopContainer,
      updateRoute: sails.helpers.caddy.updateRoute
    }
    const sequence = []
    let candidateName
    const originalLogError = sails.log.error
    sails.log.error = () => {}

    sails.helpers.docker.captureStartupDiagnostics = machineStub(async () => ({
      captured: true
    }))
    sails.helpers.docker.inspectDeploymentImage = machineStub(
      async ({ imageReference }) => ({
        imageId: imageReference.startsWith('sha256:')
          ? imageReference
          : 'sha256:' + '4'.padStart(64, '0'),
        compatibility: 'schema-1'
      })
    )
    sails.helpers.docker.ensureNetwork = machineStub(async () => {})
    sails.helpers.deploy.prepareCandidateContainer = machineStub(async () => ({
      action: 'ready'
    }))
    sails.helpers.docker.allocatePort = machineStub(async () => 1404)
    sails.helpers.docker.runContainer = machineStub(async (inputs) => {
      candidateName = inputs.containerName
      sequence.push(`started:${candidateName}`)
      return {
        containerId: 'failed-rollback-container-id',
        containerName: candidateName,
        hostPort: inputs.hostPort,
        portBinding: { diagnostic: 'verified' }
      }
    })
    sails.helpers.docker.healthCheck = machineStub(async () => {
      sequence.push('candidate-healthy')
    })
    sails.helpers.caddy.updateRoute = machineStub(async () => {
      sequence.push('route-rejected')
      const failure = new Error('Caddy rejected the rollback route')
      failure.code = 'CADDY_ROUTE_VERIFICATION_FAILED'
      throw failure
    })
    sails.helpers.docker.stopContainer = machineStub(async (inputs) => {
      sequence.push(`stopped:${inputs.containerName}`)
    })
    sails.helpers.docker.releasePort = machineStub(async () => {
      sequence.push('port-released')
      return { released: 1 }
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.executeRollback.with({
          rollbackId: setup.deployment.id,
          targetDeployment: previousDeployment,
          environment: setup.environment,
          app: setup.app
        })
      )
      const app = await sails.models.app.findOne({ id: setup.app.id })
      const rollback = await sails.models.deployment.findOne({
        id: setup.deployment.id
      })

      expect(error.message).toContain('Caddy rejected the rollback route')
      expect(app.containerName).toBe('slipway-web-previous')
      expect(app.hostPort).toBe(1401)
      expect(rollback.status).toBe('failed')
      expect(rollback.deployLogs).toContain('ERROR [traffic cutover]')
      expect(sequence).toEqual([
        `started:${candidateName}`,
        'candidate-healthy',
        'route-rejected',
        `stopped:${candidateName}`,
        'port-released'
      ])
      expect(sequence.includes('stopped:slipway-web-previous')).toBe(false)
    } finally {
      sails.helpers.docker.inspectDeploymentImage =
        originals.inspectDeploymentImage
      sails.helpers.docker.ensureNetwork = originals.ensureNetwork
      sails.helpers.deploy.prepareCandidateContainer =
        originals.prepareCandidateContainer
      sails.helpers.docker.allocatePort = originals.allocatePort
      sails.helpers.docker.runContainer = originals.runContainer
      sails.helpers.docker.healthCheck = originals.healthCheck
      sails.helpers.docker.captureStartupDiagnostics =
        originals.captureStartupDiagnostics
      sails.helpers.docker.releasePort = originals.releasePort
      sails.helpers.docker.stopContainer = originals.stopContainer
      sails.helpers.caddy.updateRoute = originals.updateRoute
      sails.log.error = originalLogError
    }
  }
)

async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error('Expected operation to fail.')
}

test(
  'startup failure captures diagnostics before removing the candidate and preserves the live app',
  { world: cutoverWorld('startup-failure-capture') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const originals = {
      inspectDeploymentImage: sails.helpers.docker.inspectDeploymentImage,
      ensureNetwork: sails.helpers.docker.ensureNetwork,
      prepareCandidateContainer: sails.helpers.deploy.prepareCandidateContainer,
      ensureBuildContext: sails.helpers.deploy.ensureBuildContext,
      buildImage: sails.helpers.docker.buildImage,
      detectFeatures: sails.helpers.sails.detectFeatures,
      allocatePort: sails.helpers.docker.allocatePort,
      runContainer: sails.helpers.docker.runContainer,
      healthCheck: sails.helpers.docker.healthCheck,
      captureStartupDiagnostics: sails.helpers.docker.captureStartupDiagnostics,
      cutoverTraffic: sails.helpers.deploy.cutoverTraffic,
      releasePort: sails.helpers.docker.releasePort,
      stopContainer: sails.helpers.docker.stopContainer,
      removeImage: sails.helpers.docker.removeImage,
      sendDeploymentNotification:
        sails.helpers.notification.sendDeploymentNotification
    }
    const originalLogError = sails.log.error
    sails.log.error = () => {}
    sails.helpers.notification.sendDeploymentNotification = machineStub(
      async () => {}
    )
    const controller = new AbortController()
    const cancellation = new Error('Cancelled by Builder')
    cancellation.code = 'DEPLOYMENT_CANCELLED'
    const sequence = []
    let candidateName
    let candidateImage

    sails.helpers.docker.captureStartupDiagnostics = machineStub(
      async (inputs) => {
        expect(inputs.containerName).toBe(candidateName)
        expect(String(inputs.deploymentId)).toBe(String(setup.deployment.id))
        sequence.push('diagnostics-captured')
        return { captured: true }
      }
    )
    sails.helpers.docker.inspectDeploymentImage = machineStub(
      async ({ imageReference }) => ({
        imageId: imageReference.startsWith('sha256:')
          ? imageReference
          : 'sha256:' + '4'.padStart(64, '0'),
        compatibility: 'schema-1'
      })
    )
    sails.helpers.docker.ensureNetwork = machineStub(async () => {})
    sails.helpers.deploy.prepareCandidateContainer = machineStub(async () => ({
      action: 'ready'
    }))
    sails.helpers.deploy.ensureBuildContext = machineStub(async () => ({
      contextPath: '/tmp/slipway-cancel-before-cutover'
    }))
    sails.helpers.docker.buildImage = machineStub(async ({ imageName }) => {
      candidateImage = imageName
      sequence.push('image-built')
    })
    sails.helpers.sails.detectFeatures = machineStub(async () => ({}))
    sails.helpers.docker.allocatePort = machineStub(async () => 1405)
    sails.helpers.docker.runContainer = machineStub(async (inputs) => {
      candidateName = inputs.containerName
      sequence.push(`started:${candidateName}`)
      return {
        containerId: 'cancelled-candidate-id',
        containerName: candidateName,
        hostPort: inputs.hostPort,
        portBinding: { diagnostic: 'verified' }
      }
    })
    sails.helpers.docker.healthCheck = machineStub(async ({ signal }) => {
      sequence.push('health-check-started')
      throw Object.assign(new Error('Synthetic candidate startup failed'), {
        code: 'DEPLOYMENT_STARTUP_EXITED'
      })
    })
    sails.helpers.deploy.cutoverTraffic = machineStub(async () => {
      sequence.push('cutover')
    })
    sails.helpers.docker.stopContainer = machineStub(
      async ({ containerName }) => {
        sequence.push(`stopped:${containerName}`)
      }
    )
    sails.helpers.docker.releasePort = machineStub(async () => {
      sequence.push('port-released')
      return { released: 1 }
    })
    sails.helpers.docker.removeImage = machineStub(async ({ imageName }) => {
      sequence.push(`removed:${imageName}`)
    })

    try {
      const error = await captureError(
        sails.helpers.deploy.executePipeline.with({
          deploymentId: setup.deployment.id,
          project: world.current.projects.deploymentTarget,
          environment: setup.environment,
          app: setup.app,
          signal: controller.signal
        })
      )
      const [app, deployment] = await Promise.all([
        sails.models.app.findOne({ id: setup.app.id }),
        sails.models.deployment.findOne({ id: setup.deployment.id })
      ])

      expect(error.code).toBe('DEPLOYMENT_STARTUP_EXITED')
      expect(deployment.status).toBe('failed')
      expect(app.containerName).toBe('slipway-web-previous')
      expect(app.hostPort).toBe(1401)
      expect(sequence).toEqual([
        'image-built',
        `started:${candidateName}`,
        'health-check-started',
        'diagnostics-captured',
        `stopped:${candidateName}`,
        'port-released',
        `removed:${candidateImage}`
      ])
      expect(deployment.deployLogs).toContain('ERROR [health check]')
    } finally {
      sails.helpers.docker.inspectDeploymentImage =
        originals.inspectDeploymentImage
      sails.helpers.docker.ensureNetwork = originals.ensureNetwork
      sails.helpers.deploy.prepareCandidateContainer =
        originals.prepareCandidateContainer
      sails.helpers.deploy.ensureBuildContext = originals.ensureBuildContext
      sails.helpers.docker.buildImage = originals.buildImage
      sails.helpers.sails.detectFeatures = originals.detectFeatures
      sails.helpers.docker.allocatePort = originals.allocatePort
      sails.helpers.docker.runContainer = originals.runContainer
      sails.helpers.docker.healthCheck = originals.healthCheck
      sails.helpers.docker.captureStartupDiagnostics =
        originals.captureStartupDiagnostics
      sails.helpers.deploy.cutoverTraffic = originals.cutoverTraffic
      sails.helpers.docker.releasePort = originals.releasePort
      sails.helpers.docker.stopContainer = originals.stopContainer
      sails.helpers.docker.removeImage = originals.removeImage
      sails.helpers.notification.sendDeploymentNotification =
        originals.sendDeploymentNotification
      sails.log.error = originalLogError
    }
  }
)

test(
  'failed final route commit restores App and recovery metadata together; failed restoration creates a durable operator hold',
  { world: cutoverWorld('recovery-metadata-transaction') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const target = await prepareRollback({ sails, setup, world })
    const recovery = require('../../../../api/lib/deployment-recovery')
    const originalUpdate = sails.helpers.caddy.updateRoute
    const originalFinish = sails.helpers.caddy.finishRouteUpdate
    const before = (
      await sails.models.setting.findOne({ key: recovery.key(setup.app.id) })
    ).value
    let failRestore = false
    sails.helpers.caddy.updateRoute = machineStub(async () => stagedRoute())
    sails.helpers.caddy.finishRouteUpdate = machineStub(async ({ action }) => {
      if (action === 'commit' || failRestore)
        throw new Error('Safe fixture route failure')
      return { action: 'rolled_back' }
    })
    const perform = () =>
      sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: setup.deployment.id,
        environmentId: setup.environment.id,
        appId: setup.app.id,
        candidate: {
          ...setup.candidate,
          imageId: target.imageId,
          recoveryCompatibility: 'schema-1'
        }
      })
    try {
      await captureError(perform())
      expect(
        (await sails.models.app.findOne({ id: setup.app.id })).currentDeployment
      ).toBe(setup.app.currentDeployment)
      expect(
        (
          await sails.models.setting.findOne({
            key: recovery.key(setup.app.id)
          })
        ).value
      ).toBe(before)
      failRestore = true
      const error = await captureError(perform())
      expect(error.code).toBe('TRAFFIC_CUTOVER_ROLLBACK_FAILED')
      expect(
        Boolean(
          await sails.models.setting.findOne({
            key: recovery.HOLD_PREFIX + setup.app.id
          })
        )
      ).toBe(true)
      const eligibility = await sails.helpers.deploy.resolveRecoveryTarget.with(
        { app: setup.app }
      )
      expect(eligibility.available).toBe(false)
      expect(eligibility.reason).toContain('operator')
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdate
      sails.helpers.caddy.finishRouteUpdate = originalFinish
    }
  }
)

test(
  'a queued rollback rejects a changed current generation before network or container work',
  { world: cutoverWorld('stale-recovery-intent') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const target = await prepareRollback({ sails, setup, world })
    const newer = await world.create('deployment').with({
      app: setup.app.id,
      environment: setup.environment.id,
      status: 'running'
    })
    await sails.models.app
      .updateOne({ id: setup.app.id })
      .set({ currentDeployment: newer.id })
    const originalNetwork = sails.helpers.docker.ensureNetwork
    let networkCalls = 0
    sails.helpers.docker.ensureNetwork = machineStub(async () => {
      networkCalls++
    })
    try {
      const error = await captureError(
        sails.helpers.deploy.executeRollback.with({
          rollbackId: setup.deployment.id,
          targetDeployment: target,
          environment: setup.environment,
          app: setup.app
        })
      )
      expect(error.message).toContain('changed')
      expect(networkCalls).toBe(0)
      expect(
        (await sails.models.app.findOne({ id: setup.app.id })).currentDeployment
      ).toBe(newer.id)
    } finally {
      sails.helpers.docker.ensureNetwork = originalNetwork
    }
  }
)

test(
  'operator recovery holds prevent restart finalization from retiring either container',
  { world: cutoverWorld('held-restart-finalization') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const recovery = require('../../../../api/lib/deployment-recovery')
    await sails.models.app.updateOne({ id: setup.app.id }).set({
      currentDeployment: setup.deployment.id,
      containerName: setup.candidate.containerName
    })
    await sails.models.setting.create({
      key: recovery.HOLD_PREFIX + setup.app.id,
      value: '{}'
    })
    const original = sails.helpers.docker.stopContainer
    let stops = 0
    sails.helpers.docker.stopContainer = machineStub(async () => {
      stops++
    })
    try {
      const error = await captureError(
        sails.helpers.deploy.finalizeCurrentCandidate.with({
          deploymentId: setup.deployment.id,
          appId: setup.app.id,
          environmentId: setup.environment.id
        })
      )
      expect(error.message).toContain('operator')
      expect(stops).toBe(0)
      expect(
        (await sails.models.app.findOne({ id: setup.app.id })).containerName
      ).toBe(setup.candidate.containerName)
    } finally {
      sails.helpers.docker.stopContainer = original
    }
  }
)

test(
  'real App/recovery commits retain the last healthy release across deploy, failed candidate, rollback and redeploy',
  { world: cutoverWorld('recovery-promotion-sequence') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    await prepareRollback({ sails, setup, world })
    const recovery = require('../../../../api/lib/deployment-recovery')
    const image = (n) => 'sha256:' + String(n).padStart(64, '0')
    const originalUpdate = sails.helpers.caddy.updateRoute
    const originalFinish = sails.helpers.caddy.finishRouteUpdate
    let failRoute = false
    sails.helpers.caddy.updateRoute = machineStub(async () => {
      if (failRoute) throw new Error('Safe fixture rejected route')
      return stagedRoute()
    })
    sails.helpers.caddy.finishRouteUpdate = machineStub(async () => ({
      action: 'committed'
    }))
    const read = async () =>
      JSON.parse(
        (
          await sails.models.setting.findOne({
            key: recovery.key(setup.app.id)
          })
        ).value
      )
    const promote = async (n, kind = 'deploy') => {
      const deployment = await world.create('deployment').with({
        app: setup.app.id,
        environment: setup.environment.id,
        status: 'deploying',
        imageName: `slipway/recovery:${n}`,
        imageId: image(n)
      })
      await sails.models.deploymentjob.create({
        deployment: deployment.id,
        targetKey: `environment:${setup.environment.id}`,
        kind
      })
      await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: deployment.id,
        environmentId: setup.environment.id,
        appId: setup.app.id,
        candidate: {
          ...setup.candidate,
          containerName: `safe-fixture-${deployment.id}`,
          imageName: deployment.imageName,
          imageId: image(n),
          recoveryCompatibility: 'schema-1'
        }
      })
      return deployment
    }
    try {
      const healthy = await promote(3)
      let state = await read()
      expect(state.current.deploymentId).toBe(String(healthy.id))
      expect(state.previous.imageId).toBe(image(2))
      failRoute = true
      await captureError(promote(4))
      expect(await read()).toEqual(state)
      failRoute = false
      const rollback = await promote(2, 'rollback')
      state = await read()
      expect(state.current.deploymentId).toBe(String(rollback.id))
      expect(state.previous).toBe(null)
      expect(state.rejectedImages).toContain(image(3))
      await promote(5)
      state = await read()
      expect(state.previous.deploymentId).toBe(String(rollback.id))
      expect(state.previous.imageId).toBe(image(2))
      expect(state.current.imageId).toBe(image(5))
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdate
      sails.helpers.caddy.finishRouteUpdate = originalFinish
    }
  }
)

test(
  'an immutable committed candidate that fails restart readiness preserves both containers under an operator hold',
  { world: cutoverWorld('recovery-restart-readiness') },
  async ({ sails, world, expect }) => {
    const setup = await prepareCutover({ sails, world })
    const recovery = require('../../../../api/lib/deployment-recovery')
    const app = await sails.models.app.updateOne({ id: setup.app.id }).set({
      currentDeployment: setup.deployment.id,
      containerName: setup.candidate.containerName,
      imageId: 'sha256:' + '9'.repeat(64)
    })
    const originalHealth = sails.helpers.docker.healthCheck
    const originalStop = sails.helpers.docker.stopContainer
    let stops = 0
    sails.helpers.docker.healthCheck = machineStub(async () => {
      throw new Error('Safe fixture: unhealthy candidate after restart')
    })
    sails.helpers.docker.stopContainer = machineStub(async () => {
      stops++
    })
    try {
      const error = await captureError(
        sails.helpers.deploy.finalizeCurrentCandidate.with({
          deploymentId: setup.deployment.id,
          appId: app.id,
          environmentId: setup.environment.id
        })
      )
      expect(error.code).toBe('TRAFFIC_RECOVERY_HEALTH_FAILED')
      expect(stops).toBe(0)
      expect(
        Boolean(
          await sails.models.setting.findOne({
            key: recovery.HOLD_PREFIX + app.id
          })
        )
      ).toBe(true)
    } finally {
      sails.helpers.docker.healthCheck = originalHealth
      sails.helpers.docker.stopContainer = originalStop
    }
  }
)

test(
  'a normal promotion preserves a provable unlabelled legacy current image without requiring a rebuild or configuration',
  { world: cutoverWorld('legacy-current-promotion') },
  async ({ sails, world, expect }) => {
    const fixture = await require('../../../support/recovery-fixture').prepare({
      sails,
      world,
      legacy: true
    })
    const recovery = require('../../../../api/lib/deployment-recovery')
    const originalUpdate = sails.helpers.caddy.updateRoute
    const originalFinish = sails.helpers.caddy.finishRouteUpdate
    sails.helpers.caddy.updateRoute = machineStub(async () => stagedRoute())
    sails.helpers.caddy.finishRouteUpdate = machineStub(async () => ({
      action: 'committed'
    }))
    try {
      const candidate = await world.create('deployment').with({
        app: fixture.app.id,
        environment: fixture.environment.id,
        status: 'deploying'
      })
      await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: candidate.id,
        appId: fixture.app.id,
        environmentId: fixture.environment.id,
        candidate: {
          containerName: 'safe-legacy-candidate',
          containerId: 'safe-fixture-id',
          imageName: 'slipway/legacy:9',
          imageId: 'sha256:' + '3'.padStart(64, '0'),
          port: 1337,
          hostPort: 1448,
          recoveryCompatibility: null
        }
      })
      const state = JSON.parse(
        (
          await sails.models.setting.findOne({
            key: recovery.key(fixture.app.id)
          })
        ).value
      )
      expect(state.previous.deploymentId).toBe(String(fixture.current.id))
      expect(state.previous.compatibility).toBe(null)
      expect(
        (await sails.models.deployment.findOne({ id: fixture.current.id }))
          .imageId
      ).toBe(state.previous.imageId)
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdate
      sails.helpers.caddy.finishRouteUpdate = originalFinish
      fixture.restore()
    }
  }
)
