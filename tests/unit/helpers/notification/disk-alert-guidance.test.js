const { test } = require('node:test')
const assert = require('node:assert/strict')
const send = require('../../../../api/helpers/notification/send-disk-space-alert')

function fixture(t, enabled = true) {
  const previous = { sails: global.sails, fetch: global.fetch }
  const messages = []
  const notification = Object.fromEntries(
    ['sendTelegram', 'sendSlack', 'sendWebhook'].map((name) => [
      name,
      {
        with: (value) => ({
          tolerate: async () => messages.push({ name, value })
        })
      }
    ])
  )
  global.fetch = async (_, options) =>
    messages.push({ name: 'discord', value: JSON.parse(options.body) })
  global.sails = {
    helpers: {
      setting: {
        get: async (key) =>
          key === 'notifyOnHighResourceUsage'
            ? String(enabled)
            : key === 'instanceName'
            ? 'Synthetic instance'
            : key === 'discordWebhookUrl'
            ? 'https://fixture.invalid/notify'
            : 'true'
      },
      notification
    },
    log: { warn() {} }
  }
  t.after(() => {
    if (previous.sails === undefined) delete global.sails
    else global.sails = previous.sails
    global.fetch = previous.fetch
  })
  return messages
}

test('disk notification guidance preserves rollback awareness across configured channels', async (t) => {
  const messages = fixture(t)
  await send.fn({ usedPercent: 93, availableGb: '23 GB' })
  assert.equal(messages.length, 4)
  for (const name of ['sendTelegram', 'sendSlack', 'discord']) {
    const value = JSON.stringify(
      messages.find((message) => message.name === name).value
    )
    assert.match(
      value,
      /Review Bosun cleanup outcomes and protected rollback images/
    )
    assert.match(value, /Avoid blanket Docker image pruning/)
    assert.doesNotMatch(
      value,
      /Consider cleaning up old images, pruning Docker/
    )
  }
  assert.equal(
    messages.find((message) => message.name === 'sendWebhook').value.event,
    'disk.low_space'
  )
})

test('disk notification opt-out sends no fixture notifications', async (t) => {
  const messages = fixture(t, false)
  await send.fn({ usedPercent: 93, availableGb: '23 GB' })
  assert.deepEqual(messages, [])
})
