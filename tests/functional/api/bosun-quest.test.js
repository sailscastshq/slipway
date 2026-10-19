const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bosun Quest requires instance authority and CSRF, and rejects arbitrary job inputs',
  { world: 'configured-slipway' },
  async ({ sails, request, world }) => {
    const previous = sails.instanceQuest
    let calls = 0
    sails.instanceQuest = {
      snapshot: async () => ({ available: true, jobs: [], runs: [] }),
      trigger: async (name, requestId, jobInputs) => {
        calls++
        assert.equal(name, 'maintain-wake')
        assert.deepEqual(jobInputs, {})
        return {
          run: { id: requestId, name, state: 'running' },
          duplicate: false
        }
      }
    }
    try {
      assert.equal((await request.get('/api/v1/bosun/quest')).status, 401)
      const browser = await withCsrfFromPage(
        request,
        '/bosun?tab=quest',
        'genesisUser'
      )
      assert.equal(
        (await browser.request.get('/api/v1/bosun/quest')).status,
        200
      )
      const body = {
        name: 'maintain-wake',
        requestId: randomUUID(),
        jobInputs: {}
      }
      assert.equal(
        (await request.as('genesisUser').post('/api/v1/bosun/quest/run', body))
          .status,
        403
      )
      assert.equal(calls, 0)
      assert.equal(
        (await browser.request.post('/api/v1/bosun/quest/run', body)).status,
        202
      )
      assert.equal(calls, 1)
      await sails.models.user
        .updateOne({ id: world.current.users.genesisUser.id })
        .set({ isGenesisUser: false })
      assert.equal(
        (await browser.request.get('/api/v1/bosun/quest')).status,
        403
      )
      assert.equal(
        (await browser.request.post('/api/v1/bosun/quest/run', body)).status,
        403
      )
      assert.equal(calls, 1)
    } finally {
      sails.instanceQuest = previous
    }
  }
)

test(
  'Bosun shared run details and retained logs require instance authority and exact retained identity',
  { world: 'configured-slipway' },
  async ({ sails, request, world }) => {
    const previous = sails.instanceQuest
    const id = randomUUID()
    const raw = {
      id,
      name: 'maintain-wake',
      trigger: 'scheduled',
      state: 'completed',
      startedAt: '2026-10-20T12:00:00.000Z',
      finishedAt: '2026-10-20T12:01:00.000Z',
      result: JSON.stringify({ status: 'available', value: false }),
      logs: { stdout: 'Safe retained fixture output', stderr: '' }
    }
    sails.instanceQuest = {
      snapshot: async () => ({ available: true, jobs: [], runs: [raw] })
    }
    const detailUrl = `/api/v1/bosun/quest/runs/${id}`
    try {
      for (const url of [detailUrl, `${detailUrl}/logs`])
        assert.equal((await request.get(url)).status, 401)
      const owner = request.as('genesisUser')
      const snapshot = await owner.get('/api/v1/bosun/quest')
      assert.equal(snapshot.status, 200)
      assert.deepEqual(snapshot.data.runs, [raw])
      assert.equal(snapshot.data.workspace.scope, 'instance')
      const detail = await owner.get(detailUrl)
      assert.equal(detail.status, 200)
      assert.equal(detail.data.run.runId, id)
      assert.equal(detail.data.run.startedAt, Date.parse(raw.startedAt))
      assert.deepEqual(detail.data.run.result, {
        status: 'available',
        value: false
      })
      const logs = await owner.get(`${detailUrl}/logs`)
      assert.equal(logs.status, 200)
      assert.equal(logs.data.stdout, raw.logs.stdout)
      assert.equal(logs.data.runId, id)
      for (const suffix of ['', '/logs']) {
        assert.equal(
          (await owner.get(`/api/v1/bosun/quest/runs/not-a-uuid${suffix}`))
            .status,
          400
        )
        assert.equal(
          (await owner.get(`/api/v1/bosun/quest/runs/${randomUUID()}${suffix}`))
            .status,
          404
        )
      }
      await sails.models.user
        .updateOne({ id: world.current.users.genesisUser.id })
        .set({ isGenesisUser: false })
      for (const url of [detailUrl, `${detailUrl}/logs`])
        assert.equal((await owner.get(url)).status, 403)
    } finally {
      sails.instanceQuest = previous
    }
  }
)
