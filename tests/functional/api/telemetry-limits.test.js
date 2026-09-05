const { test } = require('sounding')
const crypto = require('node:crypto')
const { withCsrfFromPage } = require('../../support/csrf-request')
const options = {
  world: {
    name: 'configured-slipway',
    context: { deploymentTarget: { slug: 'telemetry-limits' } }
  }
}

async function sender(request, sails, environment) {
  const token = 'stk_' + crypto.randomBytes(24).toString('hex')
  await sails.models.environment.updateOne({ id: environment.id }).set({
    telemetryTokenHash: crypto.createHash('sha256').update(token).digest('hex')
  })
  return request.withHeaders({ authorization: `Bearer ${token}` })
}

test(
  'telemetry bounds client clocks, rejects malformed items, and retains by server receipt',
  options,
  async ({ sails, world, request, expect }) => {
    const environment = world.current.environments.production
    const api = await sender(request, sails, environment)
    const now = Date.now()
    const result = await api.post('/api/v1/telemetry/ingest', {
      spans: [
        {
          name: 'future',
          startedAt: now + 100 * 86400000,
          createdAt: now + 100 * 86400000
        }
      ]
    })
    expect(result).toHaveStatus(200)
    expect(result.data.clockAdjusted).toBe(1)
    const stored = await sails.models.telemetryspan.findOne({
      environment: String(environment.id)
    })
    expect(stored.createdAt >= now && stored.createdAt < now + 10000).toBe(true)
    expect(stored.startedAt < now + 10000).toBe(true)
    expect(
      await api.post('/api/v1/telemetry/ingest', { spans: [null] })
    ).toHaveStatus(400)
    expect(
      await api.post('/api/v1/telemetry/ingest', {
        spans: [{ attributes: { huge: 'x'.repeat(33000) } }]
      })
    ).toHaveStatus(400)
    await sails.models.telemetryspan
      .updateOne({ id: stored.id })
      .set({ createdAt: now - 8 * 86400000, startedAt: now + 100 * 86400000 })
    const pruned = await sails.helpers.lookout.pruneObservability.with({
      now,
      containerRetentionMs: 86400000,
      telemetryRetentionMs: 7 * 86400000,
      batchSize: 50,
      maxBatches: 2
    })
    expect(pruned.tables.spans.deletedRows).toBe(1)
    const page = await withCsrfFromPage(
      request,
      '/projects/telemetry-limits/lookout',
      'genesisUser'
    )
    expect(page.page.data.props.ingestion.rejectedEvents).toBe(2)
  }
)

test(
  'concurrent requests cannot exceed an environment ingestion budget',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'telemetry-budget' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    sails.config.custom.observability.ingestionRequestsPerMinute = 1
    const api = await sender(
      request,
      sails,
      world.current.environments.production
    )
    const results = await Promise.all(
      [1, 2].map(() =>
        api.post('/api/v1/telemetry/ingest', {
          metrics: [{ name: 'count', value: 1 }]
        })
      )
    )
    expect(results.filter((result) => result.status === 200).length).toBe(1)
    expect(results.filter((result) => result.status === 429).length).toBe(1)
    expect(await sails.models.telemetrymetric.count()).toBe(1)
    const budget = await sails.models.telemetryingestionbudget.findOne({
      environment: String(world.current.environments.production.id)
    })
    expect(budget.requests).toBe(1)
    expect(budget.rejectedRequests).toBe(1)
  }
)
