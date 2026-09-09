const { test } = require('sounding')
const assert = require('node:assert/strict')
const { withCsrfFromPage } = require('../../support/csrf-request')
const custom = require('../../../api/lib/custom-service')

test(
  'custom HTTP routes require reviewed owner access, isolate domains, recover failures, and return to private access',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'custom-http' } }
    }
  },
  async ({ sails, world, request }) => {
    const browser = await withCsrfFromPage(request, '/', 'genesisUser')
    const service = await world.create('service').with({
      type: 'custom',
      name: 'search',
      version: 'search:1',
      status: 'running',
      containerName: 'slipway-custom-http-fixture',
      containerId: 'fixture',
      internalPort: 8080,
      environment: world.current.environments.production.id
    })
    const url = `/api/v1/services/${service.id}/public-route`
    const originalCommand = custom.command,
      originalVerify = sails.helpers.caddy.verifyRoute,
      originalFinish = sails.helpers.caddy.finishRouteUpdate
    const commands = [],
      transactions = []
    let failCommit = false,
      failRecovery = false
    custom.command = async (args) => {
      commands.push(args)
      if (args[0] === 'inspect') {
        const missing = new Error('missing')
        missing.code = 'DOCKER_MISSING'
        throw missing
      }
      return { stdout: '', stderr: '' }
    }
    sails.helpers.caddy.verifyRoute = { with: async () => ({ verified: true }) }
    sails.helpers.caddy.finishRouteUpdate = {
      with: async ({ action, transaction }) => {
        transactions.push({ action, transaction })
        if (
          (action === 'commit' && failCommit) ||
          (action === 'rollback' && failRecovery)
        )
          throw new Error('proxy unavailable')
      }
    }
    try {
      const review = await browser.request.post(url, {
        action: 'review',
        domain: 'search.example.com',
        port: 8080
      })
      assert.equal(review.status, 200, JSON.stringify(review.data))
      assert.equal(commands.length, 0)
      const applied = await browser.request.post(url, {
        action: 'apply',
        reviewId: review.data.review.id
      })
      assert.equal(applied.status, 200, JSON.stringify(applied.data))
      assert.equal(applied.data.service.publicRoute.route, 'verified')
      assert.equal(applied.data.service.publicRoute.dns, 'unverified')
      assert.equal(applied.data.service.publicRoute.tls, 'unverified')
      assert.ok(
        commands.some((args) =>
          args.includes(
            'caddy.handle_0.1_reverse_proxy=slipway-custom-http-fixture:8080'
          )
        )
      )
      assert.ok(
        commands.every(
          (args) =>
            !args.includes('-p') &&
            !args.includes('--publish') &&
            !args.includes('--privileged')
        )
      )
      const replay = await browser.request.post(url, {
        action: 'apply',
        reviewId: review.data.review.id
      })
      assert.equal(replay.status, 200)
      assert.equal(transactions.length, 1)
      const another = await world.create('service').with({
        type: 'custom',
        name: 'other',
        version: 'other:1',
        status: 'running',
        environment: service.environment
      })
      assert.equal(
        (
          await browser.request.post(
            `/api/v1/services/${another.id}/public-route`,
            { action: 'review', domain: 'search.example.com', port: 8080 }
          )
        ).status,
        400
      )
      assert.equal(
        (
          await browser.request.post(url, {
            action: 'review',
            domain: 'https://bad.example/path',
            port: 8080
          })
        ).status,
        400
      )
      const expired = await browser.request.post(url, {
        action: 'review',
        domain: 'expired.example.com',
        port: 8080
      })
      await sails.models.customservicereview
        .updateOne({ token: expired.data.review.id })
        .set({ expiresAt: 1 })
      assert.equal(
        (
          await browser.request.post(url, {
            action: 'apply',
            reviewId: expired.data.review.id
          })
        ).status,
        400
      )
      const foreign = await browser.request.post(url, {
        action: 'review',
        domain: 'foreign.example.com',
        port: 8080
      })
      await sails.models.customservicereview
        .updateOne({ token: foreign.data.review.id })
        .set({ actor: 999999 })
      assert.equal(
        (
          await browser.request.post(url, {
            action: 'apply',
            reviewId: foreign.data.review.id
          })
        ).status,
        400
      )
      const claimResults = await Promise.allSettled([
        require('../../../api/lib/domain-claims').reserve(
          ['concurrent.example.com'],
          'service:one'
        ),
        require('../../../api/lib/domain-claims').reserve(
          ['concurrent.example.com'],
          'service:two'
        )
      ])
      assert.equal(
        claimResults.filter((r) => r.status === 'fulfilled').length,
        1
      )
      assert.equal(
        await sails.models.domainclaim.count({
          domain: 'concurrent.example.com'
        }),
        1
      )
      const stale = await browser.request.post(url, {
        action: 'review',
        domain: 'stale.example.com',
        port: 8080
      })
      await sails.models.service
        .updateOne({ id: service.id })
        .set({ containerId: 'changed' })
      assert.equal(
        (
          await browser.request.post(url, {
            action: 'apply',
            reviewId: stale.data.review.id
          })
        ).status,
        400
      )
      const changed = await browser.request.post(url, {
        action: 'review',
        domain: 'new.example.com',
        port: 8080
      })
      failCommit = true
      failRecovery = true
      assert.equal(
        (
          await browser.request.post(url, {
            action: 'apply',
            reviewId: changed.data.review.id
          })
        ).status,
        400
      )
      const failed = await sails.models.service.findOne({ id: service.id })
      assert.equal(failed.publicRoute.domain, 'search.example.com')
      assert.ok(failed.publicRoute.operation)
      failRecovery = false
      const recovered = await browser.request.post(url, { action: 'recover' })
      assert.equal(recovered.status, 200, JSON.stringify(recovered.data))
      assert.equal(
        recovered.data.service.publicRoute.domain,
        'search.example.com'
      )
      assert.equal(recovered.data.service.publicRoute.operation, undefined)
      assert.equal(
        await sails.models.domainclaim.count({ domain: 'new.example.com' }),
        0
      )
      failCommit = false
      const removal = await browser.request.post(url, {
        action: 'review',
        domain: ''
      })
      const removed = await browser.request.post(url, {
        action: 'apply',
        reviewId: removal.data.review.id
      })
      assert.equal(removed.status, 200, JSON.stringify(removed.data))
      assert.equal(removed.data.service.publicRoute.route, 'private')
      assert.equal(await sails.models.service.count({ id: service.id }), 1)
      assert.equal(
        await sails.models.domainclaim.count({
          owner: `service:${service.id}`
        }),
        0
      )
      const otherOwner = await world
        .create('user')
        .with({ email: 'route-owner@example.test' })
      await sails.models.team
        .updateOne({ id: world.current.teams.genesisTeam.id })
        .set({ owner: otherOwner.id })
      await sails.models.teammembership
        .updateOne({
          user: world.current.users.genesisUser.id,
          team: world.current.teams.genesisTeam.id
        })
        .set({ role: 'member' })
      assert.equal(
        (
          await browser.request.post(url, {
            action: 'review',
            domain: 'denied.example.com',
            port: 8080
          })
        ).status,
        403
      )
    } finally {
      custom.command = originalCommand
      sails.helpers.caddy.verifyRoute = originalVerify
      sails.helpers.caddy.finishRouteUpdate = originalFinish
    }
  }
)
