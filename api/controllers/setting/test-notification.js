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

        const message = `\u2705 <b>Slipway Test Notification</b>\n\nThis is a test message from your Slipway instance. If you receive this, Telegram notifications are working correctly.\n\n<i>Slipway</i>`

        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: message,
              parse_mode: 'HTML'
            })
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
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="padding: 20px; background: #10b981; color: white; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0; font-size: 18px;">Test Notification</h2>
              </div>
              <div style="padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="margin: 0; color: #374151; font-size: 14px;">This is a test message from your Slipway instance. If you receive this, email notifications are working correctly.</p>
              </div>
              <p style="margin-top: 20px; color: #9ca3af; font-size: 12px; text-align: center;">
                Sent from Slipway
              </p>
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
