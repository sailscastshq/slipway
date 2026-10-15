const { test } = require('sounding')
const assert = require('node:assert/strict')

test('Bridge condition helpers preserve synchronous results, absent conditions and exact public messages', ({
  sails
}) => {
  const bridge = sails.helpers.bridge
  for (const name of [
    'normalizeActionConditions',
    'matchesActionConditions',
    'getActionConditionFields',
    'validateActionConditions',
    'resolveActionRecordFields',
    'describeActionConditionChange'
  ])
    assert.equal(typeof bridge[name], 'function')
  assert.equal(
    bridge.normalizeActionConditions.with({ path: 'action' }),
    undefined
  )
  assert.equal(bridge.matchesActionConditions.with({}), true)
  assert.equal(
    bridge.matchesActionConditions.with({
      condition: { 'record.id': null },
      record: {}
    }),
    false
  )
  assert.equal(
    bridge.matchesActionConditions.with({
      condition: { 'record.id': null },
      record: { id: null }
    }),
    true
  )
  const original = { 'record.status': { in: ['accepted', 'confirmed'] } }
  const normalized = bridge.normalizeActionConditions.with({
    condition: original,
    path: 'action'
  })
  assert.deepEqual(normalized, original)
  assert.notEqual(normalized['record.status'].in, original['record.status'].in)
  assert.throws(
    () =>
      bridge.normalizeActionConditions.with({
        condition: { 'form.send.deep': true },
        path: 'action'
      }),
    (error) =>
      error.message ===
      'action.visibleWhen must reference record.field or form.field.'
  )
  const action = {
    name: 'remind',
    scope: 'record',
    fields: {
      send: { type: 'boolean', field: { type: 'boolean' } },
      count: { visibleWhen: { 'form.send': true } }
    }
  }
  assert.equal(
    bridge.validateActionConditions.with({
      action,
      resource: { attributes: {}, show: [] }
    }),
    undefined
  )
  assert.deepEqual(bridge.getActionConditionFields.with({ action }), [])
  assert.deepEqual(
    bridge.resolveActionRecordFields.with({ action, record: {} }),
    action
  )
  assert.equal(
    bridge.describeActionConditionChange.with({
      resource: { singularLabel: 'Proposal' },
      fields: ['status']
    }),
    "This proposal's status changed. Reopen the action to review it before sending."
  )
  assert.equal(
    bridge.describeActionConditionChange.with({
      resource: {},
      fields: ['year', 'title']
    }),
    "This record's action fields changed. Reopen the action to review them before sending."
  )
})
