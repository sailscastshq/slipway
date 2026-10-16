const { test } = require('sounding')
const assert = require('node:assert/strict')
const { setup } = require('../../support/bridge-action-options')
const { withCsrfFromPage } = require('../../support/csrf-request')
test(
  'action option searches authorize the record, constrain fields and recheck selections on submit',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'action-options' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const state = await setup(sails, world)
    const base =
      '/projects/action-options/environments/production/bridge/submission/actions/send-decision'
    try {
      expect(
        await request
          .withHeaders({ accept: 'application/json' })
          .get(`${base}/fields/people/options?recordId=1`)
      ).toHaveStatus(401)
      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      const client = request
        .as('genesisUser')
        .withHeaders({ accept: 'application/json' })
      const context = await client.get(`${base}/context?recordId=1`)
      const token = context.data.conditionToken
      const url = (extra = {}) =>
        `${base}/fields/people/options?` +
        new URLSearchParams({
          recordId: '1',
          conditionToken: token,
          dependencies: JSON.stringify({ selectionMode: 'selected' }),
          ...extra
        })
      const result = await client.get(url())
      expect(result).toHaveStatus(200)
      assert.equal(result.data.options[0].value, 'speaker-1')
      assert.match(result.header('cache-control'), /no-store/)
      expect(
        await client.get(
          url({ dependencies: JSON.stringify({ selectionMode: 'everyone' }) })
        )
      ).toHaveStatus(400)
      expect(
        await client.get(
          url({
            dependencies: JSON.stringify({
              selectionMode: 'selected',
              helper: 'injected'
            })
          })
        )
      ).toHaveStatus(400)
      state.denied = true
      const before = state.optionCalls.length
      expect(await client.get(url())).toHaveStatus(400)
      assert.equal(state.optionCalls.length, before)
      state.denied = false
      const post = (people) =>
        client.withHeaders({ 'x-csrf-token': browser.token }).post(base, {
          recordId: 1,
          conditionToken: token,
          values: {
            selectionMode: 'selected',
            people,
            acceptanceMessage: 'Hello'
          }
        })
      expect(await post([])).toHaveStatus(400)
      expect(await post(['foreign'])).toHaveStatus(400)
      assert.equal(state.calls.length, 0)
      expect(await post(['speaker-1'])).toHaveStatus(302)
      assert.equal(state.calls.length, 1)
      state.options = []
      expect(await post(['speaker-1'])).toHaveStatus(400)
      assert.equal(state.calls.length, 1)
      state.records[1].status = 'withdrawn'
      expect(await client.get(url())).toHaveStatus(400)
    } finally {
      state.restore()
    }
  }
)
