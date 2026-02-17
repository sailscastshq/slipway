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
    smtpHost: { type: 'string' },
    smtpPort: { type: 'string' },
    smtpUser: { type: 'string' },
    smtpPassword: { type: 'string' },
    smtpFrom: { type: 'string' },
    notificationEmails: { type: 'string' }
  },

  exits: {
    success: {
      statusCode: 200
    },
    error: {
      statusCode: 500
    }
  },

  fn: async function (inputs) {
    const { channel } = inputs

    try {
      if (channel === 'telegram') {
        const botToken = inputs.telegramBotToken || await sails.helpers.setting.get('telegramBotToken', '')
        const chatId = inputs.telegramChatId || await sails.helpers.setting.get('telegramChatId', '')

        if (!botToken || !chatId) {
          return this.res.status(400).json({
            success: false,
            message: 'Telegram bot token and chat ID are required'
          })
        }

        const threadId = inputs.telegramThreadId || await sails.helpers.setting.get('telegramThreadId', '')

        const message = `\u2705 <b>Slipway Test Notification</b>\n\nThis is a test message from your Slipway instance. If you receive this, Telegram notifications are working correctly.\n\n<i>Slipway</i>`

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
          return this.res.status(400).json({
            success: false,
            message: data.description || 'Failed to send Telegram message'
          })
        }

        return { success: true, message: 'Test message sent to Telegram' }
      }

      if (channel === 'discord') {
        const webhookUrl = inputs.discordWebhookUrl || await sails.helpers.setting.get('discordWebhookUrl', '')

        if (!webhookUrl) {
          return this.res.status(400).json({
            success: false,
            message: 'Discord webhook URL is required'
          })
        }

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: 'Slipway Test Notification',
              description: 'This is a test message from your Slipway instance. If you receive this, Discord notifications are working correctly.',
              color: 0x10b981,
              footer: {
                text: 'Slipway'
              },
              timestamp: new Date().toISOString()
            }]
          })
        })

        if (!response.ok) {
          const text = await response.text()
          return this.res.status(400).json({
            success: false,
            message: text || 'Failed to send Discord message'
          })
        }

        return { success: true, message: 'Test message sent to Discord' }
      }

      if (channel === 'slack') {
        const webhookUrl = inputs.slackWebhookUrl || await sails.helpers.setting.get('slackWebhookUrl', '')

        if (!webhookUrl) {
          return this.res.status(400).json({
            success: false,
            message: 'Slack webhook URL is required'
          })
        }

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: '\u2705 *Slipway Test Notification*\n\nThis is a test message from your Slipway instance. If you receive this, Slack notifications are working correctly.\n\n_Slipway_'
          })
        })

        if (!response.ok) {
          const text = await response.text()
          return this.res.status(400).json({
            success: false,
            message: text || 'Failed to send Slack message'
          })
        }

        return { success: true, message: 'Test message sent to Slack' }
      }

      if (channel === 'webhook') {
        const url = inputs.webhookUrl || await sails.helpers.setting.get('webhookUrl', '')

        if (!url) {
          return this.res.status(400).json({
            success: false,
            message: 'Webhook URL is required'
          })
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
          return this.res.status(400).json({
            success: false,
            message: text || 'Failed to send webhook'
          })
        }

        return { success: true, message: 'Test webhook sent' }
      }

      if (channel === 'email') {
        // Get global env vars first
        let globalEnvVars = {}
        try {
          const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
          globalEnvVars = JSON.parse(globalJson)
        } catch { /* ignore */ }

        const smtpHost = inputs.smtpHost || globalEnvVars.MAIL_HOST || await sails.helpers.setting.get('smtpHost', '')
        const smtpPort = inputs.smtpPort || globalEnvVars.MAIL_PORT || await sails.helpers.setting.get('smtpPort', '587')
        const smtpUser = inputs.smtpUser || globalEnvVars.MAIL_USER || await sails.helpers.setting.get('smtpUser', '')
        const smtpPassword = inputs.smtpPassword || globalEnvVars.MAIL_PASSWORD || await sails.helpers.setting.get('smtpPassword', '')
        const smtpFrom = inputs.smtpFrom || globalEnvVars.MAIL_FROM || await sails.helpers.setting.get('smtpFrom', '')
        const notificationEmails = inputs.notificationEmails || await sails.helpers.setting.get('notificationEmails', '')

        if (!smtpHost || !notificationEmails) {
          return this.res.status(400).json({
            success: false,
            message: 'SMTP host and notification emails are required'
          })
        }

        const nodemailer = require('nodemailer')

        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: parseInt(smtpPort, 10),
          secure: smtpPort === '465',
          auth: smtpUser ? {
            user: smtpUser,
            pass: smtpPassword
          } : undefined
        })

        const emails = notificationEmails.split(',').map(e => e.trim()).filter(Boolean)

        await transporter.sendMail({
          from: smtpFrom || smtpUser || 'slipway@localhost',
          to: emails.join(', '),
          subject: 'Slipway Test Notification',
          text: 'This is a test message from your Slipway instance. If you receive this, email notifications are working correctly.',
          html: `
            <div style="width: 100%; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica', Arial, sans-serif; padding: 0; margin: 0; -webkit-font-smoothing: antialiased;">
              <div style="padding: 48px 24px 40px; max-width: 560px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 32px;">
                  <span style="font-size: 15px; font-weight: 700; letter-spacing: 0.05em; color: #192147; text-transform: uppercase;">Slipway</span>
                </div>
                <div style="background-color: #ffffff; border-radius: 12px; border: 1px solid #e4e4e7; overflow: hidden;">
                  <div style="padding: 32px 32px 28px;">
                    <div style="margin-bottom: 24px;">
                      <span style="display: inline-block; background-color: #ecfdf5; color: #059669; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 10px; border-radius: 20px;">Test</span>
                    </div>
                    <h2 style="margin: 0 0 12px 0; color: #18181b; font-size: 20px; font-weight: 600; line-height: 1.3;">Notifications are working</h2>
                    <p style="color: #52525b; font-size: 14px; line-height: 1.7; margin: 0 0 24px 0;">This is a test message from your Slipway instance. Everything is configured correctly and email notifications will be delivered to this address.</p>
                    <div style="border-top: 1px solid #f4f4f5; padding-top: 20px;">
                      <p style="color: #a1a1aa; font-size: 12px; margin: 0;">Sent from <strong style="color: #71717a;">Slipway</strong></p>
                    </div>
                  </div>
                </div>
                <div style="text-align: center; padding-top: 24px; font-size: 12px; color: #a1a1aa; line-height: 1.6;">
                  <p style="margin: 0;">Slipway &mdash; open-source deployment platform</p>
                </div>
              </div>
            </div>
          `
        })

        return { success: true, message: 'Test email sent' }
      }
    } catch (err) {
      sails.log.error('Test notification failed:', err)
      return this.res.status(500).json({
        success: false,
        message: err.message || 'Failed to send test notification'
      })
    }
  }
}
