const { test } = require('sounding')
const assert = require('node:assert/strict')
test('Bridge detailed notifications preserve safe text, clamp details and reject malformed counts', async ({
  sails
}) => {
  const normalize = (value) =>
    sails.helpers.bridge.normalizeActionNotification.with({ value })
  const result = normalize({
    title: 'Speaker email preview',
    type: 'info',
    counts: [{ label: 'recipients', value: 118 }],
    subject: 'Final checklist',
    items: Array.from({ length: 118 }, (_, i) => `person-${i}@example.com`),
    message: 'Nothing sent.',
    html: '<script>bad</script>'
  })
  assert.equal(result.items.length, 100)
  assert.equal(result.omittedItems, 18)
  assert.equal(result.html, undefined)
  assert.equal(
    normalize({ title: 'Preview', items: ['<script>alert(1)</script>'] })
      .items[0],
    '<script>alert(1)</script>'
  )
  assert.equal(
    normalize({ title: 'x', counts: [{ label: 'sent', value: -1 }] }),
    null
  )
  assert.equal(normalize({ title: 'x', items: [{}] }), null)
  assert.equal(normalize('legacy message'), null)
})
test('Bridge execution preserves opt-in structured notification and legacy message behavior', async ({
  sails
}) => {
  const original = {
    build: sails.helpers.bridge.buildSailsWrapper,
    execute: sails.helpers.bridge.executeInContainer
  }
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  let result = {
    message: 'Legacy feedback',
    notification: {
      title: 'Preview',
      counts: [{ label: 'recipients', value: 1 }],
      items: ['alex@example.com'],
      private: 'discard'
    }
  }
  sails.helpers.bridge.executeInContainer = async (_, code) => ({
    success: true,
    output: JSON.stringify(
      await new Function('sails', `return(async()=>{${code}})()`)({
        helpers: { bridge: { preview: { with: async () => result } } }
      })
    )
  })
  try {
    const input = {
      containerName: 'test',
      resource: { identity: 'event', primaryKey: 'id' },
      action: { name: 'preview', helper: 'bridge.preview', fields: {} },
      actor: { id: 'admin' },
      values: {},
      recordId: 'event'
    }
    const output = await sails.helpers.bridge.executeCustomAction.with(input)
    assert.equal(output.notification.title, 'Preview')
    assert.equal(output.notification.private, undefined)
    assert.equal(output.message, 'Legacy feedback')
    result = { message: 'Still ordinary' }
    assert.deepEqual(
      await sails.helpers.bridge.executeCustomAction.with(input),
      { message: 'Still ordinary' }
    )
  } finally {
    sails.helpers.bridge.buildSailsWrapper = original.build
    sails.helpers.bridge.executeInContainer = original.execute
  }
})
