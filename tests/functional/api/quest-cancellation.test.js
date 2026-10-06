const assert = require('node:assert/strict')
const { test } = require('sounding')
const workspace = require('../../../api/lib/quest-workspace')
const {
  worldFor,
  residentFixture,
  bearerRequest
} = require('../../support/quest-resident-fixture')

test(
  'cancellation stays capability gated, app scoped, resident confirmed and audited without another invocation',
  { transport: 'http', world: worldFor('quest-cancellation') },
  async (context) => {
    const f = await residentFixture(context, 'quest-cancellation')
    try {
      const client = await bearerRequest(
        context,
        context.world.current.users.genesisUser
      )
      const accepted = await client.post(
        `${f.base}/jobs/synthetic-report/run`,
        f.body()
      )
      assert.equal(accepted.status, 202)
      const url = `${f.base}/runs/${accepted.data.run.runId}/cancel`
      assert.equal(
        (await client.post(url, { runtimeId: f.info.runtimeId })).status,
        409
      )
      f.info.capabilities.cancellation = true
      let controls = 0
      f.emitter.quest.cancel = (runId) => {
        controls++
        f.bridge.record('cancelling', {
          runId,
          runtimeId: f.info.runtimeId,
          name: f.job.name,
          sequence: 2,
          timestamp: Date.now()
        })
        return Promise.resolve({ state: 'cancelling' })
      }
      workspace.invalidate(f.app)
      assert.equal(
        (await client.post(url, { runtimeId: 'changed-runtime' })).status,
        409
      )
      assert.equal(controls, 0)
      const cancelling = await client.post(url, { runtimeId: f.info.runtimeId })
      assert.equal(cancelling.status, 202)
      assert.equal(cancelling.data.run.state, 'cancelling')
      assert.equal(f.starts.length, 1)
      f.bridge.record('cancelled', {
        runId: accepted.data.run.runId,
        runtimeId: f.info.runtimeId,
        name: f.job.name,
        sequence: 3,
        timestamp: Date.now(),
        signal: 'SIGTERM'
      })
      const repeated = await client.post(url, { runtimeId: f.info.runtimeId })
      assert.equal(repeated.status, 202)
      assert.equal(repeated.data.run.state, 'cancelled')
      assert.equal(controls, 1)
      assert.equal(f.starts.length, 1)
      const audits = await context.sails.models.auditlog.find({
        action: 'quest.run.cancel.requested'
      })
      assert.equal(audits.length, 2)
      assert.ok(
        audits.every((item) => item.details.runId === accepted.data.run.runId)
      )
    } finally {
      f.restore()
    }
  }
)
