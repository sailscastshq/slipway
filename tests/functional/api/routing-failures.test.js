const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'environment routing failures preserve saved settings and return a failure',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'routing-failures' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const env = world.current.environments.production
    await sails.models.environment
      .updateOne({ id: env.id })
      .set({ domain: 'old.example.com' })
    const browser = await withCsrfFromPage(
      request,
      '/projects/routing-failures',
      'genesisUser'
    )
    const originalUpdate = sails.helpers.caddy.updateRoute
    const originalFinish = sails.helpers.caddy.finishRouteUpdate
    let phase = 'stage-fails'
    const stage = async (options) => {
      expect(options.domainOverride).toBe('new.example.com')
      expect(
        (await sails.models.environment.findOne({ id: env.id })).domain
      ).toBe('old.example.com')
      if (phase === 'stage-fails') throw new Error('Caddy unavailable')
      return { transaction: { test: true } }
    }
    stage.with = stage
    const finish = async ({ action }) => {
      if (phase === 'commit-fails' && action === 'commit')
        throw new Error('Caddy cutover failed')
    }
    finish.with = finish
    sails.helpers.caddy.updateRoute = stage
    sails.helpers.caddy.finishRouteUpdate = finish
    try {
      const endpoint = `/api/v1/projects/routing-failures/environments/${env.slug}`
      for (const step of ['stage-fails', 'commit-fails']) {
        phase = step
        const result = await browser.request.patch(endpoint, {
          domain: 'new.example.com',
          name: 'Changed name'
        })
        expect(result).toHaveStatus(503)
        expect(result.data.message).toContain(
          'Previous settings were preserved'
        )
        const unchanged = await sails.models.environment.findOne({ id: env.id })
        expect(unchanged.domain).toBe('old.example.com')
        expect(unchanged.name).toBe(env.name)
      }
      phase = 'success'
      expect(
        await browser.request.patch(endpoint, { domain: 'new.example.com' })
      ).toHaveStatus(200)
      expect(
        (await sails.models.environment.findOne({ id: env.id })).domain
      ).toBe('new.example.com')
    } finally {
      sails.helpers.caddy.updateRoute = originalUpdate
      sails.helpers.caddy.finishRouteUpdate = originalFinish
    }
  }
)

test(
  'instance settings never claim success after a dashboard route failure',
  { world: 'configured-slipway' },
  async ({ sails, request, expect }) => {
    await sails.helpers.setting.set(
      'instanceDomain',
      'old-dashboard.example.com'
    )
    const browser = await withCsrfFromPage(
      request,
      '/settings/instance',
      'genesisUser'
    )
    const original = sails.helpers.caddy.updateDashboardRoute
    const fail = async () => {
      throw new Error('Caddy unavailable')
    }
    fail.with = fail
    sails.helpers.caddy.updateDashboardRoute = fail
    try {
      const result = await browser.request.patch('/settings/instance', {
        instanceDomain: 'new-dashboard.example.com'
      })
      expect(result).toHaveStatus(303)
      expect(result).toHaveHeader('x-exit', 'invalid')
      expect(await sails.helpers.setting.get('instanceDomain')).toBe(
        'old-dashboard.example.com'
      )
      const page = await browser.request.get('/settings/instance')
      expect(JSON.stringify(page.data)).toContain(
        'Previous settings were preserved'
      )
    } finally {
      sails.helpers.caddy.updateDashboardRoute = original
    }
  }
)
