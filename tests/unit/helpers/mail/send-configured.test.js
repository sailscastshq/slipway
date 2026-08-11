const { test } = require('sounding')

test('configured mail syncs UI SMTP settings before delegating', async ({
  sails,
  expect
}) => {
  const originalSyncSmtpConfig = sails.helpers.setting.syncSmtpConfig
  const originalSendWith = sails.helpers.mail.send.with
  const originalDefaultMailer = sails.config.mail.default
  const originalMailers = sails.config.mail.mailers
  const originalFrom = sails.config.mail.from
  const calls = []
  let sentMessage

  try {
    sails.config.mail.default = 'smtp'
    sails.config.mail.mailers = {
      smtp: {
        transport: 'smtp'
      }
    }
    sails.config.mail.from = {}
    sails.helpers.setting.syncSmtpConfig = async () => {
      calls.push('sync')
      sails.config.mail.mailers.smtp = {
        transport: 'smtp',
        host: 'localhost',
        port: 1025,
        username: 'project.9',
        password: 'secret'
      }
      sails.config.mail.from = {
        address: 'slippy@sailscasts.com',
        name: 'Slippy from Slipway'
      }
    }
    sails.helpers.mail.send.with = async (message) => {
      calls.push('send')
      sentMessage = message
      return {}
    }

    await sails.helpers.mail.sendConfigured.with({
      to: 'friend@example.com',
      subject: 'Hello',
      template: 'test-notification',
      templateData: {
        instanceName: 'Slipway'
      }
    })

    expect(calls).toEqual(['sync', 'send'])
    expect(sentMessage.from).toBe('slippy@sailscasts.com')
    expect(sentMessage.fromName).toBe('Slippy from Slipway')
    expect(sentMessage.layout).toBe('mail')
    expect(sentMessage.mailer).toMatch(/^smtp-[0-9a-f]{12}$/)
    expect(sails.config.mail.mailers[sentMessage.mailer]).toEqual({
      transport: 'smtp',
      host: 'localhost',
      port: 1025,
      username: 'project.9',
      password: 'secret'
    })
  } finally {
    sails.helpers.setting.syncSmtpConfig = originalSyncSmtpConfig
    sails.helpers.mail.send.with = originalSendWith
    sails.config.mail.default = originalDefaultMailer
    sails.config.mail.mailers = originalMailers
    sails.config.mail.from = originalFrom
  }
})
