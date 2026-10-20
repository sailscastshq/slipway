const { test } = require('sounding')
const assert = require('node:assert/strict')
const { setup } = require('../../support/bridge-dependent-defaults')

test(
  'Bridge defaults JSON routes authorize the form and bound provider inputs and outputs',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'dependent-defaults' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const state = await setup(sails, world)
    const suffix =
      '/session/defaults?dependencies=' +
      encodeURIComponent(
        JSON.stringify({ event: 'event-1', proposal: 'proposal-1' })
      )
    const base = '/projects/dependent-defaults/environments/production'
    try {
      for (const path of [
        `${base}/bridge`,
        `/api/v1${base}/bridge`,
        `/api/v1${base}/apps/web/bridge`
      ]) {
        const response = await request.as('genesisUser').get(path + suffix)
        expect(response).toHaveStatus(200)
        assert.equal(response.data.values.title, 'Building with Sails')
      }
      assert.deepEqual(state.defaultsCalls[0].values, {
        event: 'event-1',
        proposal: 'proposal-1'
      })
      assert.equal(state.defaultsCalls[0].surface, 'create')
      const edit = await request
        .as('genesisUser')
        .get('/api/v1' + base + '/bridge' + suffix + '&surface=edit&recordId=1')
      expect(edit).toHaveStatus(200)
      assert.equal(state.defaultsCalls.at(-1).surface, 'edit')
      assert.equal(state.defaultsCalls.at(-1).recordId, 1)
      const url = `/api/v1${base}/bridge/session/defaults`
      for (const deps of [
        [],
        { event: 'event-1', proposal: 'proposal-1', helper: 'arbitrary' },
        { event: 'event-2', proposal: 'proposal-1' },
        { event: 'event-1', proposal: 'invalid' }
      ]) {
        expect(
          await request
            .as('genesisUser')
            .get(
              `${url}?dependencies=${encodeURIComponent(JSON.stringify(deps))}`
            )
        ).toHaveStatus(400)
      }
      state.response = { values: { secret: 'Must never be returned' } }
      expect(
        await request
          .as('genesisUser')
          .get('/api/v1' + base + '/bridge' + suffix)
      ).toHaveStatus(400)
      state.response = { values: { title: { arbitrary: true } } }
      expect(
        await request
          .as('genesisUser')
          .get('/api/v1' + base + '/bridge' + suffix)
      ).toHaveStatus(400)
      state.response = { values: {} }
      expect(
        await request
          .as('genesisUser')
          .get('/api/v1' + base + '/bridge' + suffix)
      ).toHaveStatus(200)
      state.denyDefaults = true
      expect(
        await request
          .as('genesisUser')
          .get('/api/v1' + base + '/bridge' + suffix)
      ).toHaveStatus(403)
    } finally {
      state.restore()
    }
  }
)
