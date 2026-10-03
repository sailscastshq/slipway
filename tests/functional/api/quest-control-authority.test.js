const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
const workspace = require('../../../api/lib/quest-workspace')
const {
  worldFor,
  residentFixture
} = require('../../support/quest-resident-fixture')

// Actual scoped requests/ledger, synthetic resident transport. This regression
// changes app state without the explicit invalidation used by older fixtures.
test(
  'Quest cached controls lose authority when app state changes while retained receipts stay readable and reconnect refreshes evidence',
  { world: worldFor('quest-control-authority') },
  async (context) => {
    const f = await residentFixture(context, 'quest-control-authority')
    const { sails, request, world } = context
    try {
      const browser = await withCsrfFromPage(request, f.page, 'genesisUser')
      const environment = await sails.models.environment.findOne({
        id: world.current.environments.production.id
      })
      const target = { app: f.app, environment, user: { teamRole: 'owner' } }
      const runId = crypto.randomUUID()
      f.bridge.record('completed', {
        name: f.job.name,
        runId,
        runtimeId: f.info.runtimeId,
        sequence: 2,
        startedAt: Date.now() - 1000,
        finishedAt: Date.now(),
        duration: 1000,
        result: { status: 'available', value: false },
        logs: { stdout: 'retained synthetic log', stderr: '' }
      })
      const warmed = await workspace.snapshot(target)
      assert.equal(warmed.capabilities.invoke, true)
      const original = await browser.request.get(`${f.base}/runs/${runId}`)
      assert.equal(original.status, 200)
      for (const status of ['stopped', 'failed']) {
        await sails.models.app.updateOne({ id: f.app.id }).set({ status })
        const before = f.calls.length
        for (const [url, body] of [
          [`${f.base}/jobs/${f.job.name}/run`, f.body()],
          [`${f.page}/${f.job.name}/pause`, { runtimeId: f.info.runtimeId }],
          [`${f.page}/${f.job.name}/resume`, { runtimeId: f.info.runtimeId }]
        ])
          assert.equal((await browser.request.post(url, body)).status, 409)
        assert.equal(
          f.calls.length,
          before,
          'No resident command while unavailable'
        )
        assert.equal(f.starts.length, 0)
        assert.equal(f.job.paused, false)
        const retained = await browser.request.get(`${f.base}/runs/${runId}`)
        assert.equal(retained.status, 200)
        assert.deepEqual(retained.data.run, original.data.run)
        const logs = await browser.request.get(`${f.base}/runs/${runId}/logs`)
        assert.equal(logs.status, 200)
        assert.equal(logs.data.stdout, 'retained synthetic log')
        assert.equal(
          f.calls.length,
          before,
          'Retained reads use only the ledger'
        )
        await sails.models.app
          .updateOne({ id: f.app.id })
          .set({ status: 'running' })
        const recovered = await workspace.snapshot(target)
        assert.equal(recovered.capabilities.invoke, true)
        assert.equal(
          f.calls.length,
          before + 1,
          'Reconnect obtains a fresh snapshot'
        )
      }
      assert.equal(
        (
          await browser.request.post(
            `${f.base}/jobs/${f.job.name}/run`,
            f.body()
          )
        ).status,
        202
      )
      assert.equal(f.starts.length, 1)
    } finally {
      f.restore()
    }
  }
)
