module.exports = {
  friendlyName: 'Test notification',

  description: 'Send a test notification via the specified channel.',

  inputs: {
    channel: {
      type: 'string',
      required: true,
      isIn: ['telegram', 'discord', 'email', 'slack', 'webhook']
    },
    // Form values passed from the client (used as fallback when settings haven't been saved yet)
    telegramBotToken: { type: 'string' },
    telegramChatId: { type: 'string' },
    telegramThreadId: { type: 'string' },
    discordWebhookUrl: { type: 'string' },
    slackWebhookUrl: { type: 'string' },
    webhookUrl: { type: 'string' },
    notificationEmails: { type: 'string' },
    smtpHost: { type: 'string' },
    smtpPort: { type: 'string' },
    smtpUser: { type: 'string' },
    smtpPassword: { type: 'string' },
    smtpFrom: { type: 'string' }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    invalid: {
      responseType: 'badRequest'
    }
  },

  fn: async function (inputs) {
    const { channel } = inputs
    const fail = (message) => {
      throw new Error(message)
    }
    const succeed = (message) => {
      sails.inertia.flash('success', message)
      return '/settings/notifications'
    }

    try {
      if (channel === 'telegram') {
        const botToken =
          inputs.telegramBotToken ||
          (await sails.helpers.setting.get('telegramBotToken', ''))
        const chatId =
          inputs.telegramChatId ||
          (await sails.helpers.setting.get('telegramChatId', ''))

        if (!botToken || !chatId) {
          return fail('Telegram bot token and chat ID are required')
        }

        const threadId =
          inputs.telegramThreadId ||
          (await sails.helpers.setting.get('telegramThreadId', ''))

        const message = `\u2705 <b>You're all set!</b>\n\nHey! It's Slippy. Just a quick wave \u2014 your Telegram notifications are configured and working perfectly. I'll keep you posted on deployments, backups, and anything else that needs your attention.\n\n<b>\u2014 Slippy \uD83D\uDC19</b>`

        const payload = {
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        }

        if (threadId) {
          payload.message_thread_id = parseInt(threadId, 10)
        }

        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }
        )

        const data = await response.json()
        if (!data.ok) {
          return fail(
            data.description || 'Failed to send Telegram test message'
          )
        }

        return succeed('Test message sent to Telegram.')
      }

      if (channel === 'discord') {
        const webhookUrl =
          inputs.discordWebhookUrl ||
          (await sails.helpers.setting.get('discordWebhookUrl', ''))

        if (!webhookUrl) {
          return fail('Discord webhook URL is required')
        }

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [
              {
                title: "\u2705 You're all set!",
                description:
                  "Hey! It's Slippy. Just a quick wave \u2014 your Discord notifications are configured and working perfectly. I'll keep you posted on deployments, backups, and anything else that needs your attention.",
                color: 0x10b981,
                footer: {
                  text: '\u2014 Slippy \uD83D\uDC19'
                },
                timestamp: new Date().toISOString()
              }
            ]
          })
        })

        if (!response.ok) {
          const text = await response.text()
          return fail(text || 'Failed to send Discord test message')
        }

        return succeed('Test message sent to Discord.')
      }

      if (channel === 'slack') {
        const webhookUrl =
          inputs.slackWebhookUrl ||
          (await sails.helpers.setting.get('slackWebhookUrl', ''))

        if (!webhookUrl) {
          return fail('Slack webhook URL is required')
        }

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: "\u2705 *You're all set!*\n\nHey! It's Slippy. Just a quick wave \u2014 your Slack notifications are configured and working perfectly. I'll keep you posted on deployments, backups, and anything else that needs your attention.\n\n*\u2014 Slippy \uD83D\uDC19*"
          })
        })

        if (!response.ok) {
          const text = await response.text()
          return fail(text || 'Failed to send Slack test message')
        }

        return succeed('Test message sent to Slack.')
      }

      if (channel === 'webhook') {
        const url =
          inputs.webhookUrl ||
          (await sails.helpers.setting.get('webhookUrl', ''))

        if (!url) {
          return fail('Webhook URL is required')
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'notification.test',
            timestamp: new Date().toISOString(),
            data: {
              message: 'This is a test notification from your Slipway instance.'
            }
          })
        })

        if (!response.ok) {
          const text = await response.text()
          return fail(text || 'Failed to send test webhook')
        }

        return succeed('Test webhook sent.')
      }

      if (channel === 'email') {
        const notificationEmails =
          inputs.notificationEmails ||
          (await sails.helpers.setting.get('notificationEmails', ''))

        if (!notificationEmails) {
          return fail('Notification email addresses are required')
        }

        // Save SMTP settings first so sails-hook-mail can use them
        if (inputs.smtpHost) {
          await sails.helpers.setting.set('smtpHost', inputs.smtpHost.trim())
        }
        if (inputs.smtpPort) {
          await sails.helpers.setting.set('smtpPort', inputs.smtpPort.trim())
        }
        if (inputs.smtpUser) {
          await sails.helpers.setting.set('smtpUser', inputs.smtpUser.trim())
        }
        if (inputs.smtpPassword) {
          await sails.helpers.setting.set('smtpPassword', inputs.smtpPassword)
        }
        if (inputs.smtpFrom) {
          await sails.helpers.setting.set('smtpFrom', inputs.smtpFrom.trim())
        }
        if (inputs.notificationEmails) {
          await sails.helpers.setting.set(
            'notificationEmails',
            inputs.notificationEmails.trim()
          )
        }

        const emails = notificationEmails
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean)
        const instanceName = await sails.helpers.setting.get(
          'instanceName',
          'Slipway'
        )

        for (const to of emails) {
          await sails.helpers.mail.sendConfigured.with({
            to,
            subject: 'Slipway Test Notification',
            template: 'test-notification',
            templateData: { instanceName }
          })
        }

        return succeed('Test email sent.')
      }
    } catch (err) {
      sails.log.warn('Test notification failed:', err)
      throw {
        invalid: {
          problems: [
            {
              [channel]: err.message || 'Failed to send test notification'
            }
          ]
        }
      }
    }
  }
}
