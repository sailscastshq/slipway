const { test } = require('sounding')
const assert = require('node:assert/strict')
const models = {
  event: {
    identity: 'event',
    primaryKey: 'id',
    attributes: { id: { type: 'string' }, title: { type: 'string' } }
  }
}
const captions = {
  field: 'send',
  whenFalse: {
    label: 'Preview recipients',
    processingLabel: 'Previewing recipients…'
  },
  whenTrue: { label: 'Send reminders', processingLabel: 'Sending reminders…' }
}
const config = (submit) => ({
  resources: {
    event: {
      actions: {
        remind: {
          scope: 'record',
          helper: 'bridge.remind',
          label: 'Remind speakers',
          fields: {
            send: { type: 'boolean', default: false },
            subject: { type: 'text' }
          },
          ...(submit === undefined ? {} : { submit })
        }
      }
    }
  }
})
test('Bridge preserves legacy captions and normalizes boolean-field submit captions', async ({
  sails
}) => {
  const normalize = (submit) =>
    sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config: config(submit)
    })
  const before = (await normalize()).resources.event.actionDefinitions.remind
  assert.equal(before.label, 'Remind speakers')
  assert.equal(before.submit, undefined)
  const after = (await normalize(captions)).resources.event.actionDefinitions
    .remind
  assert.deepEqual(after.submit, captions)
  assert.equal(after.label, before.label)
  assert.deepEqual(after.fields, before.fields)
})
test('Bridge rejects caption contracts with undeclared/non-boolean fields, unbounded labels or unknown keys', async ({
  sails
}) => {
  for (const submit of [
    null,
    [],
    'send',
    {},
    { ...captions, field: 'missing' },
    { ...captions, field: 'subject' },
    { ...captions, field: '__proto__' },
    { ...captions, extra: true },
    { ...captions, whenTrue: undefined },
    { ...captions, whenFalse: { label: '  ', processingLabel: 'Working' } },
    {
      ...captions,
      whenFalse: { label: 'x'.repeat(81), processingLabel: 'Working' }
    },
    { ...captions, whenTrue: { label: 'Send', processingLabel: '' } },
    {
      ...captions,
      whenTrue: {
        label: 'Send',
        processingLabel: 'Sending',
        html: '<b>Send</b>'
      }
    }
  ])
    await assert.rejects(
      sails.helpers.bridge.normalizeResourceContract.with({
        models,
        config: config(submit)
      }),
      /submit/
    )
})
test('Bridge caption selection uses explicit true and keeps defaults compatible', async () => {
  const { bridgeActionSubmitCaption } = await import(
    '../../../../assets/js/lib/bridge/action-submit.mjs'
  )
  const action = { label: 'Remind speakers', submit: captions }
  for (const send of [undefined, null, false, '', 'true', 1])
    assert.deepEqual(
      bridgeActionSubmitCaption(action, { send }),
      captions.whenFalse
    )
  assert.deepEqual(
    bridgeActionSubmitCaption(action, { send: true }),
    captions.whenTrue
  )
  assert.deepEqual(bridgeActionSubmitCaption({ label: 'Publish' }), {
    label: 'Publish',
    processingLabel: 'Running…'
  })
})
