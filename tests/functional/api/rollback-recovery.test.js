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
      appSlug: setup.app.slug
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
      setup.artifacts.set(setup.previous.imageId, 'schema-1')
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
