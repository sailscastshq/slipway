const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const workspace = require('../../../api/lib/quest-workspace')
const {
  worldFor,
  residentFixture,
  bearerRequest
} = require('../../support/quest-resident-fixture')

test(
  'Quest HTTP routes admit canonical resident runs once, preserve typed inputs and enforce runtime pause and overlap',
  { transport: 'http', world: worldFor('quest-resident-http') },
  async (context) => {
    const f = await residentFixture(context, 'quest-resident-http')
    const { sails, world } = context
    try {
      const client = await bearerRequest(
        context,
        world.current.users.genesisUser
      )
      const url = `${f.base}/jobs/synthetic-report/run`
      for (const jobInputs of [
        false,
        0,
        '',
        { enabled: 'false' },
        { count: -1 },
        { count: 11 },
        { unknown: true },
        { payload: 'x'.repeat(17 * 1024) },
        JSON.parse('{"constructor":{}}')
      ])
        assert.equal(
          (await client.post(url, f.body({ jobInputs }))).status,
          400
        )
      assert.equal(f.starts.length, 0)
      assert.equal(
        (await client.post(`${f.base}/jobs/unknown/run`, f.body())).status,
        409
      )
      const body = f.body({
        jobInputs: {
          enabled: false,
          count: 0,
          label: '',
          payload: { zero: 0, flag: false, empty: [] }
        }
      })
      const first = await client.post(url, body)
      const repeated = await client.post(url, body)
      assert.equal(first.status, 202)
      assert.equal(repeated.status, 202)
      assert.equal(first.data.run.runId, f.starts[0].runId)
      assert.equal(repeated.data.run.runId, first.data.run.runId)
      assert.equal(first.data.run.state, 'running')
      assert.deepEqual(f.starts[0].inputs, body.jobInputs)
      assert.equal(f.starts.length, 1)
      assert.equal(await sails.models.questrun.count(), 1)
      assert.equal(
        (await client.post(url, { ...body, jobInputs: { count: 2 } })).status,
        400
      )
      assert.equal(f.starts.length, 1)
      const pause = `/projects/quest-resident-http/quest/synthetic-report/pause`
      const resume = `/projects/quest-resident-http/quest/synthetic-report/resume`
      assert.equal(
        (await client.post(pause, { runtimeId: 'stale' })).status,
        409
      )
      assert.equal(f.job.paused, false)
      assert.equal(
        (await client.post(pause, { runtimeId: f.info.runtimeId })).status,
        200
      )
      assert.equal((await client.post(url, f.body())).status, 409)
      assert.equal(f.starts.length, 1)
      assert.equal(
        (await client.post(resume, { runtimeId: f.info.runtimeId })).status,
        200
      )
      f.job.runningCount = 1
      workspace.invalidate(f.app)
      assert.equal((await client.post(url, f.body())).status, 409)
      assert.equal(f.starts.length, 1)
      // A stale request is rejected by the bridge even after a cached snapshot.
      f.info.runtimeId = 'restarted-runtime'
      assert.equal(
        (await client.post(url, { ...body, requestId: crypto.randomUUID() }))
          .status,
        409
      )
      assert.equal(f.starts.length, 1)
    } finally {
      f.restore()
    }
  }
)
