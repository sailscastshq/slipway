const { test } = require('sounding')
const helper = require('../../../../api/helpers/notification/send-email')

test('email notifications fan out through configured mail', async ({
  expect
}) => {
  const originalSails = global.sails
  const messages = []

  try {
    global.sails = {
      helpers: {
        setting: {
          get: async (key, fallback) => {
            if (key === 'notificationEmails') {
              return 'one@example.com, two@example.com'
            }
            return fallback
          }
        },
        mail: {
          sendConfigured: {
            with: async (message) => {
              messages.push(message)
            }
          }
        }
      }
    }

    await helper.fn({
      template: 'deployment-notification',
      subject: 'Deployment succeeded',
      templateData: { appName: 'Slipway' }
    })

    expect(messages).toEqual([
      {
        to: 'one@example.com',
        subject: 'Deployment succeeded',
        template: 'deployment-notification',
        templateData: { appName: 'Slipway' }
      },
      {
        to: 'two@example.com',
        subject: 'Deployment succeeded',
        template: 'deployment-notification',
        templateData: { appName: 'Slipway' }
      }
    ])
  } finally {
    global.sails = originalSails
  }
})

test('notification emails deduplicate recipients and continue after a recipient fails', async () => {
  const assert = require('node:assert/strict')
  const original = global.sails
  const sent = []
  global.sails = {
    log: { warn() {} },
    helpers: {
      setting: {
        get: async () => 'one@example.com, ONE@example.com, two@example.com'
      },
      mail: {
        sendConfigured: {
          with: async ({ to }) => {
            sent.push(to)
            if (to === 'one@example.com') throw new Error('fixture failure')
          }
        }
      }
    }
  }
  try {
    await assert.rejects(
      helper.fn({ template: 'fixture', subject: 'fixture', templateData: {} }),
      (error) => error === 'error'
    )
    assert.deepEqual(sent, ['one@example.com', 'two@example.com'])
  } finally {
    global.sails = original
  }
})
