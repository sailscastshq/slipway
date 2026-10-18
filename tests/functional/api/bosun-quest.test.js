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
