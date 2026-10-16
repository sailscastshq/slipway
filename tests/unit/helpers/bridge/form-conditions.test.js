const { test } = require('sounding')
const assert = require('node:assert/strict')
const conditions = {
  matches: (condition, record, form, scope) =>
    sails.helpers.bridge.matchesActionConditions.with({
      condition,
      record,
      form,
      scope
    }),
  fields: (action) =>
    sails.helpers.bridge.getActionConditionFields.with({ action }),
  effective: (action, record) =>
    sails.helpers.bridge.resolveActionRecordFields.with({ action, record })
}
const models = {
  event: {
    identity: 'event',
    primaryKey: 'id',
    attributes: { id: { type: 'string' }, title: { type: 'string' } }
  }
}
const config = () => ({
  resources: {
    event: {
      title: 'title',
      show: ['id', 'title'],
      actions: {
        remind: {
          scope: 'record',
          helper: 'bridge.remind',
          fields: {
            send: { type: 'boolean', default: false },
            confirmRecipients: {
              type: 'number',
              min: 1,
              required: true,
              visibleWhen: { 'form.send': true }
            }
          }
        }
      }
    }
  }
})
test('form conditions normalize, hide stale values, and require visible counts without coercion', async ({
  sails
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models,
    config: config()
  })
  const resource = contract.resources.event,
    action = resource.actionDefinitions.remind
  const allow = (values) =>
    sails.helpers.bridge.allowActionValues.with({ values, resource, action })
  assert.deepEqual(conditions.fields(action), [])
  assert.equal(Object.keys(conditions.effective(action, {}).fields).length, 2)
  for (const count of [undefined, null, '', 18, 'invalid']) {
    assert.deepEqual(
      await allow({
        send: false,
        ...(count === undefined ? {} : { confirmRecipients: count })
      }),
      { send: false }
    )
  }
  assert.deepEqual(await allow({}), { send: false })
  for (const count of [undefined, null, ''])
    await assert.rejects(
      allow({
        send: true,
        ...(count === undefined ? {} : { confirmRecipients: count })
      })
    )
  assert.deepEqual(await allow({ send: true, confirmRecipients: 18 }), {
    send: true,
    confirmRecipients: 18
  })
  assert.deepEqual(await allow({ send: false, confirmRecipients: 18 }), {
    send: false
  })
  assert.deepEqual(await allow({ send: true, confirmRecipients: 18 }), {
    send: true,
    confirmRecipients: 18
  })
  for (const send of [1, 'true'])
    await assert.rejects(allow({ send, confirmRecipients: 18 }))
  assert.deepEqual(await allow({ send: null, confirmRecipients: 18 }), {
    send: null
  })
  await assert.rejects(allow({ send: false, unknown: 1 }))
  const { visibleBridgeActionFields } = await import(
    '../../../../assets/js/lib/bridge/action-fields.mjs'
  )
  const numeric = {
    fields: {
      mode: { type: 'number', field: { type: 'number' } },
      details: { visibleWhen: { 'form.mode': 2 } }
    }
  }
  assert.deepEqual(
    visibleBridgeActionFields(numeric, { mode: '2' }).map((f) => f.name),
    ['mode', 'details']
  )
  for (const send of [false, true, false, true])
    assert.deepEqual(
      visibleBridgeActionFields(action, { send }).map((f) => f.name),
      send ? ['send', 'confirmRecipients'] : ['send']
    )
})
test('form conditions reject malformed, undeclared, unsafe, dependent, and mismatched references', async ({
  sails
}) => {
  for (const condition of [
    { 'form.missing': true },
    { 'form.send.deep': true },
    { 'form.constructor': true },
    { 'form.confirmRecipients': 1 },
    { 'form.send': 'true' },
    { 'form.send': { in: [] } }
  ]) {
    const input = config()
    input.resources.event.actions.remind.fields.confirmRecipients.visibleWhen =
      condition
    await assert.rejects(
      sails.helpers.bridge.normalizeResourceContract.with({
        models,
        config: input
      })
    )
  }
  for (const type of ['json', 'textarea', 'richtext', 'email']) {
    const input = config()
    input.resources.event.actions.remind.fields.send = { type }
    await assert.rejects(
      sails.helpers.bridge.normalizeResourceContract.with({
        models,
        config: input
      })
    )
  }
  const input = config()
  input.resources.event.actions.remind.visibleWhen = { 'form.send': true }
  await assert.rejects(
    sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config: input
    })
  )
})

test('mixed form and saved-record conditions retain AND semantics and reject conditional drivers', async ({
  sails
}) => {
  const input = config()
  input.resources.event.actions.remind.fields.send.visibleWhen = {
    'record.title': 'Ready'
  }
  await assert.rejects(
    sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config: input
    })
  )
  const mixed = { 'record.title': 'Ready', 'form.send': true }
  assert.equal(
    conditions.matches(mixed, { title: 'Ready' }, { send: true }),
    true
  )
  assert.equal(
    conditions.matches(mixed, { title: 'Other' }, { send: true }),
    false
  )
  assert.equal(
    conditions.matches(mixed, { title: 'Ready' }, { send: false }),
    false
  )
  assert.equal(
    conditions.matches({ 'form.send': { in: [true] } }, {}, { send: true }),
    true
  )
})
