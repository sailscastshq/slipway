const { test } = require('sounding')
const assert = require('node:assert/strict')
const { withCsrfFromPage } = require('../../support/csrf-request')
const custom = require('../../../api/lib/custom-service')
test(
  'reviewed custom updates preserve links, redact secrets, reject persistent/stale/unauthorized changes and recover cutovers',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'custom-update' } }
    }
  },
  async ({ sails, world, request }) => {
    const browser = await withCsrfFromPage(request, '/', 'genesisUser')
    const image = { Id: 'sha256:' + 'a'.repeat(64), Config: {} }
    const definition = custom.validate({
      image: 'fixture/service:1',
      name: 'helper',
      port: 8080,
      env: { TOKEN: 'original-secret' },
      healthCommand: ['wget', 'http://localhost:8080'],
      appIds: []
    })
    const service = await world.create('service').with({
      type: 'custom',
      name: 'helper',
      version: definition.image,
      environment: world.current.environments.production.id,
      status: 'running',
      containerName: 'slipway-update-test',
      containerId: 'original',
      internalHost: 'slipway-update-test',
      internalPort: 8080,
      imageReference: image.Id,
      customDefinition: definition,
      customState: {
        volumes: [],
        image: definition.image,
        appIds: [],
        linkPrefix: 'HELPER'
      }
    })
    const originals = {
      command: custom.command,
      inspect: custom.inspectContainer,
      image: custom.inspectImage,
      create: custom.createContainer
    }
    const containers = new Map([
      [
        service.containerName,
        {
          Id: 'original',
          Mounts: [],
          State: { Running: true, Health: { Status: 'healthy' } }
        }
      ]
    ])
    let number = 0,
      unhealthy = false,
      interrupt = false,
      cannotRecover = false
    custom.inspectImage = async () => image
    custom.inspectContainer = async ({ containerName }) =>
      containers.get(containerName) || null
    custom.createContainer = async (candidate, config) => {
      assert.equal(candidate.imageReference, image.Id)
      assert.equal(config.env.TOKEN, 'rotated-secret')
      containers.set(candidate.containerName, {
        Id: `candidate-${++number}`,
        Mounts: [],
        State: {
          Running: false,
          Health: { Status: unhealthy ? 'unhealthy' : 'healthy' }
        }
      })
    }
    custom.command = async (args) => {
      if (args[0] === 'image') return { stdout: JSON.stringify([image]) }
      if (args[0] === 'rename') {
        if (interrupt && args[1].includes('-candidate-'))
          throw Error('cutover interrupted')
        if (cannotRecover && args[1].includes('-previous-'))
          throw Error('recovery unavailable')
        containers.set(args[2], containers.get(args[1]))
        containers.delete(args[1])
      }
      if (args[0] === 'rm') containers.delete(args.at(-1))
      if (['start', 'stop'].includes(args[0]))
        containers.get(args[1]).State.Running = args[0] === 'start'
      return { stdout: '' }
    }
    const url = `/api/v1/services/${service.id}/custom-update`
    const post = (body) => browser.request.post(url, body)
    const changes = {
      image: 'fixture/service:2',
      env: { TOKEN: 'rotated-secret' }
    }
    try {
      await sails
        .getDatastore()
        .transaction(async (db) =>
          custom.links(
            await sails.models.service.findOne({ id: service.id }),
            [String(world.current.apps.web.id)],
            db
          )
        )
      let result = await post({ action: 'review', changes })
      assert.equal(result.status, 200, JSON.stringify(result.data))
      assert.ok(!JSON.stringify(result.data).includes('secret'))
      const stale = result.data.review.id
      await sails.models.service
        .updateOne({ id: service.id })
        .set({ containerId: 'changed' })
      assert.equal(
        (await post({ action: 'apply', reviewId: stale })).status,
        400
      )
      await sails.models.service
        .updateOne({ id: service.id })
        .set({ containerId: 'original' })
      result = await post({ action: 'review', changes })
      const token = result.data.review.id
      const applied = await post({ action: 'apply', reviewId: token })
      assert.equal(applied.status, 200, JSON.stringify(applied.data))
      assert.ok(!JSON.stringify(applied.data).includes('secret'))
      assert.equal(applied.data.service.customRecovery, undefined)
      assert.equal(applied.data.service.internalHost, service.internalHost)
      const app = await sails.models.app
        .findOne({ id: world.current.apps.web.id })
        .decrypt()
      assert.equal(app.secureEnvVars.HELPER_HOST, service.internalHost)
      assert.equal(
        app.envVarMetadata.HELPER_HOST.description,
        `custom-service:${service.id}`
      )
      assert.equal(
        (await post({ action: 'apply', reviewId: token })).status,
        200
      )
      assert.equal(number, 1)
      const revert = await post({ action: 'revert' })
      assert.equal(revert.status, 200, JSON.stringify(revert.data))
      assert.equal(revert.data.review.after.image, definition.image)
      unhealthy = true
      result = await post({ action: 'review', changes })
      assert.equal(
        (await post({ action: 'apply', reviewId: result.data.review.id }))
          .status,
        400
      )
      assert.equal(containers.get(service.containerName).Id, 'candidate-1')
      unhealthy = false
      interrupt = true
      cannotRecover = true
      result = await post({ action: 'review', changes })
      assert.equal(
        (await post({ action: 'apply', reviewId: result.data.review.id }))
          .status,
        400
      )
      const failed = await sails.models.service.findOne({ id: service.id })
      assert.equal(failed.status, 'failed')
      assert.ok(failed.customState.update)
      assert.equal((await post({ action: 'review', changes })).status, 400)
      assert.equal(
        (
          await browser.request.post(
            `/api/v1/services/${service.id}/public-route`,
            { action: 'review', domain: 'helper.example.com', port: 8080 }
          )
        ).status,
        400
      )
      interrupt = false
      cannotRecover = false
      const recovered = await post({ action: 'recover' })
      assert.equal(recovered.status, 200, JSON.stringify(recovered.data))
      assert.equal(containers.get(service.containerName).Id, 'candidate-1')
      result = await post({ action: 'review', changes })
      await sails.models.customservicereview
        .updateOne({ token: result.data.review.id })
        .set({ expiresAt: 1 })
      assert.equal(
        (await post({ action: 'apply', reviewId: result.data.review.id }))
          .status,
        400
      )
      image.Config.Volumes = { '/data': {} }
      assert.equal((await post({ action: 'review', changes })).status, 400)
      image.Config.Volumes = {}
      assert.equal(
        (await post({ action: 'review', changes: { healthCommand: [] } }))
          .status,
        400
      )
      const other = await world
        .create('user')
        .with({ email: 'update-owner@example.test' })
      await sails.models.team
        .updateOne({ id: world.current.teams.genesisTeam.id })
        .set({ owner: other.id })
      await sails.models.teammembership
        .updateOne({
          user: world.current.users.genesisUser.id,
          team: world.current.teams.genesisTeam.id
        })
        .set({ role: 'member' })
      assert.equal((await post({ action: 'review', changes })).status, 403)
      const audit = await sails.models.auditlog.find({
        resourceId: String(service.id)
      })
      assert.ok(!JSON.stringify(audit).includes('secret'))
    } finally {
      custom.command = originals.command
      custom.inspectContainer = originals.inspect
      custom.inspectImage = originals.image
      custom.createContainer = originals.create
    }
  }
)
