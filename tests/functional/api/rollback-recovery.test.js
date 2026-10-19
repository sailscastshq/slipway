const { test } = require('sounding')
const assert = require('node:assert/strict')
const { prepare } = require('../../support/recovery-fixture')
const { withCsrfFromPage } = require('../../support/csrf-request')
const guard = require('../../../api/lib/image-operation-guard')

test(
  'rollback API matches stopped-target eligibility, rejects stale/wrong-app/missing images and protects intent from cleanup',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'rollback-api-proof' } }
    }
  },
  async ({ sails, request, world }) => {
    const setup = await prepare({ sails, world })
    const original = sails.helpers.deploy.runQueuedDeployments
    let starts = 0
    const dispatch = async () => {
      starts++
    }
    dispatch.with = dispatch
    sails.helpers.deploy.runQueuedDeployments = dispatch
    const url = `/api/v1/projects/${world.current.projects.deploymentTarget.slug}/environments/${setup.environment.slug}/rollback`
    const body = {
      deploymentId: String(setup.previous.id),
      expectedCurrent: String(setup.current.id),
      appSlug: setup.app.slug,
      acknowledgeUnknownCompatibility: true
    }
    try {
      assert.equal((await request.post(url, body)).status, 403)
      assert.equal(
        (await request.as('genesisUser').post(url, body)).status,
        403
      )
      const browser = await withCsrfFromPage(
        request,
        `/projects/${world.current.projects.deploymentTarget.slug}/deployments/${setup.previous.id}`,
        'genesisUser'
      )
      assert.equal(browser.page.data.props.recovery.available, true)
      assert.equal(
        browser.page.data.props.recovery.requiresCompatibilityAcknowledgement,
        true
      )
      assert.equal(
        (
          await browser.request.post(url, {
            ...body,
            acknowledgeUnknownCompatibility: false
          })
        ).status,
        400
      )
      assert.equal(
        browser.page.data.props.recovery.targetDeploymentId,
        String(setup.previous.id)
      )
      assert.equal(
        (
          await sails.helpers.deploy.resolveRecoveryTarget.with({
            app: setup.app,
            deploymentId: String(setup.previous.id)
          })
        ).available,
        true
      )
      assert.equal(
        (
          await browser.request.post(url, {
            ...body,
            expectedCurrent: '999999'
          })
        ).status,
        400
      )
      assert.equal(
        (
          await browser.request.post(url, {
            ...body,
            deploymentId: String(setup.current.id)
          })
        ).status,
        400
      )
      const other = await world.create('deployment').with({
        environment: setup.environment.id,
        app: null,
        status: 'stopped',
        imageId: setup.previous.imageId,
        imageName: 'slipway/wrong:9'
      })
      assert.equal(
        (
          await browser.request.post(url, {
            ...body,
            deploymentId: String(other.id)
          })
        ).status,
        400
      )
      setup.artifacts.delete(setup.previous.imageId)
      assert.equal((await browser.request.post(url, body)).status, 400)
      setup.artifacts.set(setup.previous.imageId, 'schema-2')
      assert.equal((await browser.request.post(url, body)).status, 400)
      setup.artifacts.set(setup.previous.imageId, null)
      const result = await browser.request.post(url, body)
      assert.equal(result.status, 202)
      await new Promise(setImmediate)
      assert.equal(starts, 1)
      const queued = await sails.models.deployment.findOne({
        id: result.data.deployment.id
      })
      assert.equal(queued.app, setup.app.id)
      assert.equal(queued.imageId, setup.previous.imageId)
      assert.ok(
        await sails.models.setting.findOne({
          key: `rollbackIntent:v1:${queued.id}`
        })
      )
      assert.equal((await browser.request.post(url, body)).status, 400)
      const hold = await guard.acquire(sails.config.appPath, 'cleanup')
      try {
        await assert.rejects(
          sails.helpers.deploy.queueDeployment.with({
            app: setup.app,
            values: { environment: setup.environment.id },
            dispatch: false
          }),
          { code: 'E_IMAGE_OPERATIONS_BUSY' }
        )
      } finally {
        await hold()
      }
      assert.equal(starts, 1)
    } finally {
      await new Promise(setImmediate)
      setup.restore()
      sails.helpers.deploy.runQueuedDeployments = original
    }
  }
)

test(
  'unlabelled legacy apps bootstrap immediately from verified successful build receipts and bind immutable IDs under admission',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'legacy-recovery-proof' } }
    }
  },
  async ({ sails, request, world }) => {
    const { image } = require('../../support/recovery-fixture')
    const recovery = require('../../../api/lib/deployment-recovery')
    const setup = await prepare({ sails, world, legacy: true })
    const originalDispatch = sails.helpers.deploy.runQueuedDeployments
    const originalInspect = sails.helpers.docker.inspectDeploymentImage
    const inspected = []
    const inspect = async (input) => {
      inspected.push(input.imageReference)
      return originalInspect.with(input)
    }
    inspect.with = inspect
    sails.helpers.docker.inspectDeploymentImage = inspect
    const dispatch = async () => {}
    dispatch.with = dispatch
    sails.helpers.deploy.runQueuedDeployments = dispatch
    const url = `/api/v1/projects/${world.current.projects.deploymentTarget.slug}/environments/${setup.environment.slug}/rollback`
    const body = {
      deploymentId: String(setup.previous.id),
      expectedCurrent: String(setup.current.id),
      appSlug: setup.app.slug,
      acknowledgeUnknownCompatibility: true
    }
    try {
      await world.create('deployment').with({
        app: setup.app.id,
        environment: setup.environment.id,
        status: 'failed'
      })
      let result = await sails.helpers.deploy.resolveRecoveryTarget.with({
        app: setup.app
      })
      assert.equal(result.available, true)
      assert.equal(result.requiresCompatibilityAcknowledgement, true)
      assert.equal(result.imageId, image(1))
      assert.equal(
        await sails.models.setting.findOne({ key: recovery.key(setup.app.id) }),
        undefined
      )
      assert.equal(
        (await sails.models.deployment.findOne({ id: setup.previous.id }))
          .imageId,
        null
      )
      assert.ok(inspected.every((ref) => recovery.IMAGE_ID.test(ref)))
      await sails.models.deployment.updateOne({ id: setup.previous.id }).set({
        buildLogs: 'The tag exists, but no immutable receipt is available.'
      })
      result = await sails.helpers.deploy.resolveRecoveryTarget.with({
        app: setup.app
      })
      assert.equal(result.available, false)
      assert.match(result.reason, /receipt|mutable tag/i)
      await sails.models.deployment
        .updateOne({ id: setup.previous.id })
        .set({ buildLogs: setup.previous.buildLogs })
      const cleanupHold = await guard.acquire(sails.config.appPath, 'cleanup')
      try {
        await assert.rejects(
          sails.helpers.deploy.queueDeployment.with({
            app: setup.app,
            kind: 'rollback',
            targetDeploymentId: setup.previous.id,
            expectedCurrent: String(setup.current.id),
            acknowledgeUnknownCompatibility: true,
            values: { environment: setup.environment.id },
            dispatch: false
          }),
          { code: 'E_IMAGE_OPERATIONS_BUSY' }
        )
      } finally {
        await cleanupHold()
      }
      assert.equal(
        await sails.models.setting.findOne({ key: recovery.key(setup.app.id) }),
        undefined
      )
      const browser = await withCsrfFromPage(
        request,
        `/projects/${world.current.projects.deploymentTarget.slug}/deployments/${setup.previous.id}`,
        'genesisUser'
      )
      assert.equal(browser.page.data.props.recovery.available, true)
      assert.equal(
        (
          await browser.request.post(url, {
            ...body,
            acknowledgeUnknownCompatibility: false
          })
        ).status,
        400
      )
      assert.equal((await browser.request.post(url, body)).status, 202)
      await new Promise(setImmediate)
      const state = JSON.parse(
        (
          await sails.models.setting.findOne({
            key: recovery.key(setup.app.id)
          })
        ).value
      )
      assert.equal(state.current.imageId, image(2))
      assert.equal(state.previous.imageId, image(1))
      assert.equal(
        (await sails.models.app.findOne({ id: setup.app.id })).imageId,
        image(2)
      )
      assert.equal(
        (await sails.models.deployment.findOne({ id: setup.previous.id }))
          .imageId,
        image(1)
      )
      const policy = await sails.helpers.imageRetention.getPolicy()
      const plan = await sails.helpers.imageRetention.getPlan.with({
        policy,
        inventory: {
          containers: [],
          images: [setup.previous, setup.current].map((deployment, index) => ({
            id: image(index + 1),
            tags: [deployment.imageName],
            digests: [],
            size: 1000,
            created: '2020-01-01T00:00:00Z'
          }))
        }
      })
      assert.ok(
        plan.protected
          .find((item) => item.id === image(1))
          .reasons.includes('recovery-previous')
      )
      assert.ok(
        plan.protected
          .find((item) => item.id === image(2))
          .reasons.includes('recovery-current')
      )
    } finally {
      await new Promise(setImmediate)
      sails.helpers.deploy.runQueuedDeployments = originalDispatch
      setup.restore()
    }
  }
)

test(
  'legacy bootstrap does not look past rollback history into a potentially rejected older image',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'legacy-rejected-barrier' } }
    }
  },
  async ({ sails, world }) => {
    const { image } = require('../../support/recovery-fixture')
    const environment = world.current.environments.production
    const app = world.current.apps.web
    const older = await world.create('deployment').with({
      app: app.id,
      environment: environment.id,
      status: 'stopped',
      startedAt: Date.now() - 11000,
      finishedAt: Date.now() - 10000,
      imageId: image(9),
      imageName: 'slipway/older:1'
    })
    const setup = await prepare({ sails, world, legacy: true })
    try {
      setup.artifacts.set(image(9), null)
      await sails.models.deployment.updateOne({ id: setup.previous.id }).set({
        buildLogs: `#12 writing image ${image(
          2
        )} done\n#12 naming to docker.io/${setup.previous.imageName} done\n`
      })
      await sails.models.deploymentjob.create({
        deployment: setup.previous.id,
        kind: 'rollback',
        targetDeploymentId: older.id,
        targetKey: `environment:${environment.id}`,
        stage: 'complete'
      })
      let result = await sails.helpers.deploy.resolveRecoveryTarget.with({
        app: setup.app
      })
      assert.equal(result.available, false)
      assert.match(result.reason, /rejected/)
      await sails.models.deployment
        .updateOne({ id: setup.current.id })
        .set({ gitMessage: `Rollback to deployment ${older.id}` })
      result = await sails.helpers.deploy.resolveRecoveryTarget.with({
        app: setup.app
      })
      assert.equal(result.available, false)
      assert.match(result.reason, /rollback history/)
    } finally {
      setup.restore()
    }
  }
)

test(
  'worker execution rejects an unknown-compatibility intent without acknowledgement before operational work',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'unacknowledged-recovery-intent' } }
    }
  },
  async ({ sails, world }) => {
    const setup = await prepare({ sails, world })
    const originalNetwork = sails.helpers.docker.ensureNetwork
    let networkCalls = 0
    const network = async () => {
      networkCalls++
    }
    network.with = network
    sails.helpers.docker.ensureNetwork = network
    try {
      const attempt = await world.create('deployment').with({
        app: setup.app.id,
        environment: setup.environment.id,
        status: 'pending'
      })
      await sails.models.setting.create({
        key: `rollbackIntent:v1:${attempt.id}`,
        value: JSON.stringify({
          appId: setup.app.id,
          environmentId: setup.environment.id,
          expectedCurrent: String(setup.current.id),
          targetDeploymentId: setup.previous.id,
          imageId: setup.previous.imageId,
          compatibility: null
        })
      })
      await assert.rejects(
        sails.helpers.deploy.executeRollback.with({
          rollbackId: attempt.id,
          app: setup.app,
          targetDeployment: setup.previous,
          environment: setup.environment
        }),
        /not acknowledged/
      )
      assert.equal(networkCalls, 0)
      assert.equal(
        (await sails.models.app.findOne({ id: setup.app.id }))
          .currentDeployment,
        setup.current.id
      )
    } finally {
      sails.helpers.docker.ensureNetwork = originalNetwork
      setup.restore()
    }
  }
)
