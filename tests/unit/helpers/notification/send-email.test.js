const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const helper = require('../../../../api/helpers/notification/send-email')

test('notification call sites leave layouts to configured mail', ({
  expect
}) => {
  const notificationDir = path.join(process.cwd(), 'api/helpers/notification')
  const offenders = fs
    .readdirSync(notificationDir)
    .filter((file) => file.endsWith('.js'))
    .filter((file) => {
      const source = fs.readFileSync(path.join(notificationDir, file), 'utf8')
      return (
        source.includes('sails.helpers.notification.sendEmail') &&
        /^\s*layout\s*:/m.test(source)
      )
    })

  expect(offenders).toEqual([])
})

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
