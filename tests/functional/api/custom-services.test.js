const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
const assert = require('node:assert/strict')
const custom = require('../../../api/lib/custom-service')
test(
  'custom service reviews bind exact images, protect secrets and preserve owned app links',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'custom-service-api' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const browser = await withCsrfFromPage(request, '/', 'genesisUser')
    const url =
      '/api/v1/projects/custom-service-api/environments/production/services/custom/review'
    const originalInspect = custom.inspectImage,
      originalStart = custom.start
    custom.inspectImage = async () => ({
      Id: 'sha256:' + 'a'.repeat(64),
      Config: { ExposedPorts: { '8080/tcp': {} }, Volumes: { '/data': {} } }
    })
    let starts = 0
    custom.start = async (service) => {
      starts++
      await sails.models.service
        .updateOne({ id: service.id })
        .set({ status: 'running' })
    }
    try {
      const definition = {
        image: 'example/service:1.0',
        env: { TOKEN: 'private-custom-token' },
        appIds: [String(world.current.apps.web.id)]
      }
      const reviewed = await browser.request.post(url, { definition })
      expect(reviewed).toHaveStatus(200)
      assert.equal(
        JSON.stringify(reviewed.data).includes('private-custom-token'),
        false
      )
      const id = reviewed.data.review.id
      assert.equal(
        (
          await sails.models.customservicereview.findOne({ token: id })
        ).definition.includes('private-custom-token'),
        false
      )
      const created = await browser.request.post('/api/v1/services/custom', {
        reviewId: id
      })
      expect(created).toHaveStatus(201)
      const service = created.data.service
      assert.equal(
        JSON.stringify(created.data).includes('private-custom-token'),
        false
      )
      expect(
        await browser.request.post('/api/v1/services/custom', { reviewId: id })
      ).toHaveStatus(201)
      assert.equal(starts, 1)
      const app = await sails.models.app
        .findOne({ id: world.current.apps.web.id })
        .decrypt()
      assert.equal(app.secureEnvVars.SERVICE_PORT, '8080')
      assert.equal(app.secureEnvVars.SERVICE_HOST, service.internalHost)
      const raw = await sails.models.service.findOne({ id: service.id })
      assert.equal(JSON.stringify(raw).includes('private-custom-token'), false)
      for (const route of [
        `/api/v1/services/${service.id}`,
        '/projects/custom-service-api/environments/production',
        `/projects/custom-service-api/environments/production/services/${service.id}`
      ]) {
        const response = await browser.request.get(route, {
          headers: { 'X-Inertia': 'true' }
        })
        expect(response).toHaveStatus(200)
        assert.equal(
          JSON.stringify(response.data).includes('private-custom-token'),
          false
        )
      }
      expect(
        await browser.request.patch(`/api/v1/services/${service.id}`, {
          resourceLimits: { cpus: '1', memory: '512m' }
        })
      ).toHaveStatus(400)
      expect(
        await browser.request.post(url, {
          definition: { ...definition, privileged: true }
        })
      ).toHaveStatus(400)
      expect(
        await browser.request.post(url, {
          definition: { ...definition, image: 'example/service:latest' }
        })
      ).toHaveStatus(400)
      expect(
        await browser.request.post(url, {
          definition: { ...definition, volumes: ['/var/run/docker.sock'] }
        })
      ).toHaveStatus(400)
      assert.equal(
        custom.redactLogs('token=private-custom-token', {
          env: definition.env
        }),
        'token=[REDACTED]'
      )
      for (const patch of [
        { image: 'evil.example/service:1' },
        { network: 'host' },
        { portBindings: ['8080:8080'] },
        { volumes: ['/data', '/data/nested'] },
        { memoryMiB: 99999 },
        { cpus: 999 },
        { env: { TOKEN: 'value\nOTHER=injected' } },
        { appIds: 'invalid' }
      ])
        expect(
          await browser.request.post(url, {
            definition: { ...definition, ...patch }
          })
        ).toHaveStatus(400)
      const concurrent = await browser.request.post(url, {
        definition: { ...definition, name: 'concurrent', appIds: [] }
      })
      const results = await Promise.all(
        [1, 2].map(() =>
          browser.request.post('/api/v1/services/custom', {
            reviewId: concurrent.data.review.id
          })
        )
      )
      results.forEach((result) => expect(result).toHaveStatus(201))
      assert.equal(results[0].data.service.id, results[1].data.service.id)
      assert.equal(starts, 2)
      assert.equal(
        await sails.models.service.count({
          environment: raw.environment,
          name: 'concurrent'
        }),
        1
      )
      const inherited = await sails.models.environment
        .findOne({ id: raw.environment })
        .decrypt()
      await sails.models.environment
        .updateOne({ id: inherited.id })
        .set({ envVars: { ...inherited.envVars, COLLISION_HOST: 'keep' } })
      const collision = await browser.request.post(url, {
        definition: { ...definition, name: 'collision' }
      })
      expect(collision).toHaveStatus(200)
      expect(
        await browser.request.post('/api/v1/services/custom', {
          reviewId: collision.data.review.id
        })
      ).toHaveStatus(400)
      assert.equal(
        await sails.models.service.count({
          environment: raw.environment,
          name: 'collision'
        }),
        0
      )
      // Unlink preserves unrelated data and any subsequently changed value.
      await sails.models.app.updateOne({ id: app.id }).set({
        secureEnvVars: {
          ...app.secureEnvVars,
          OTHER: 'kept',
          SERVICE_HOST: 'changed-outside-link'
        }
      })
      expect(
        await browser.request.patch(
          `/api/v1/services/${service.id}/custom-links`,
          { appIds: [] }
        )
      ).toHaveStatus(200)
      const unlinked = await sails.models.app.findOne({ id: app.id }).decrypt()
      assert.equal(unlinked.secureEnvVars.OTHER, 'kept')
      assert.equal(unlinked.secureEnvVars.SERVICE_HOST, 'changed-outside-link')
      assert.equal(unlinked.secureEnvVars.SERVICE_PORT, undefined)
      assert.equal(unlinked.envVarMetadata.SERVICE_HOST.managed, false)
      const expired = await browser.request.post(url, {
        definition: { ...definition, name: 'expired', appIds: [] }
      })
      await sails.models.customservicereview
        .updateOne({ token: expired.data.review.id })
        .set({ expiresAt: 1 })
      expect(
        await browser.request.post('/api/v1/services/custom', {
          reviewId: expired.data.review.id
        })
      ).toHaveStatus(400)
      const otherOwner = await world
        .create('user')
        .with({ email: 'custom-owner@example.test' })
      await sails.models.team
        .updateOne({ id: world.current.teams.genesisTeam.id })
        .set({ owner: otherOwner.id })
      await sails.models.teammembership
        .updateOne({
          user: world.current.users.genesisUser.id,
          team: world.current.teams.genesisTeam.id
        })
        .set({ role: 'member' })
      expect(await browser.request.post(url, { definition })).toHaveStatus(403)
      expect(
        await browser.request.patch(
          `/api/v1/services/${service.id}/custom-links`,
          { appIds: [] }
        )
      ).toHaveStatus(403)
    } finally {
      custom.inspectImage = originalInspect
      custom.start = originalStart
    }
  }
)
