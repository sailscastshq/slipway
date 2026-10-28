const { test } = require('node:test')
const assert = require('node:assert/strict')
const create = require('../../../api/lib/image-guard-recovery')
function fixture() {
  const state = {
    counts: [0, 0, 0, 0, 0],
    active: 0,
    update: { phase: 'idle' }
  }
  const models = {}
  for (const [index, name] of [
    'deploymentjob',
    'deployment',
    'deploymentlease',
    'cleanupoperation',
    'setting'
  ].entries())
    models[name] = { count: async () => state.counts[index] }
  const sails = {
    models,
    helpers: {
      buildCacheRetention: {
        getUpdateStatus: async () => state.update,
        getInventory: async () => ({ active: state.active })
      }
    }
  }
  return { state, recovery: create(sails) }
}
test('dead-owner recovery requires both initial and fresh durable inactivity plus idle Docker cache', async () => {
  const { state, recovery } = fixture()
  assert.equal(await recovery.prepare(), true)
  assert.equal(await recovery.verify(), true)
  for (let index = 0; index < state.counts.length; index++) {
    state.counts[index] = 1
    assert.equal(await recovery.verify(), false)
    assert.equal(await recovery.prepare(), false)
    state.counts[index] = 0
  }
  state.active = 1
  assert.equal(await recovery.prepare(), false)
})
test('unavailable or stale inventory cannot authorize guard retirement', async () => {
  assert.equal(await create({}).prepare(), false)
  const { recovery } = fixture()
  const now = Date.now
  try {
    Date.now = () => 10000
    assert.equal(await recovery.prepare(), true)
    Date.now = () => 9999
    assert.equal(await recovery.verify(), false)
    Date.now = () => 15001
    assert.equal(await recovery.verify(), false)
  } finally {
    Date.now = now
  }
})

test('recovery rechecks updater ownership and clears failed preparation evidence', async () => {
  const { state, recovery } = fixture()
  assert.equal(await recovery.prepare(), true)
  state.update = { phase: 'success', maintenanceBusy: true }
  assert.equal(await recovery.verify(), false)
  assert.equal(await recovery.prepare(), false)
  state.update = { phase: 'idle' }
  assert.equal(await recovery.verify(), false)
  assert.equal(await recovery.prepare(), true)
  state.update = { phase: 'interrupted' }
  assert.equal(await recovery.verify(), false)
})
