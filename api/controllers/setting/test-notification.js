module.exports = {
  friendlyName: 'Test notification',

  description: 'Send a test notification via the specified channel.',

  inputs: {
    channel: {
      type: 'string',
      required: true,
      isIn: ['telegram', 'discord', 'email']
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    error: {
      statusCode: 500
    }
  },

  fn: async function ({ channel }) {
    try {
      if (channel === 'telegram') {
        const botToken = await sails.helpers.setting.get('telegramBotToken', '')
        const chatId = await sails.helpers.setting.get('telegramChatId', '')

        if (!botToken || !chatId) {
          return this.res.status(400).json({
            success: false,
            message: 'Telegram bot token and chat ID are required'
          })
        }

        const message = `*Slipway Test Notification*\n\nThis is a test message from your Slipway instance. If you receive this, Telegram notifications are working correctly.`

        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: message,
              parse_mode: 'Markdown'
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
        const webhookUrl = await sails.helpers.setting.get('discordWebhookUrl', '')

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

      if (channel === 'email') {
        // Get global env vars first
        let globalEnvVars = {}
        try {
          const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
          globalEnvVars = JSON.parse(globalJson)
        } catch { /* ignore */ }

        const smtpHost = globalEnvVars.MAIL_HOST || await sails.helpers.setting.get('smtpHost', '')
        const smtpPort = globalEnvVars.MAIL_PORT || await sails.helpers.setting.get('smtpPort', '587')
        const smtpUser = globalEnvVars.MAIL_USER || await sails.helpers.setting.get('smtpUser', '')
        const smtpPassword = globalEnvVars.MAIL_PASSWORD || await sails.helpers.setting.get('smtpPassword', '')
        const smtpFrom = globalEnvVars.MAIL_FROM || await sails.helpers.setting.get('smtpFrom', '')
        const notificationEmails = await sails.helpers.setting.get('notificationEmails', '')

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
            <div style="font-family: sans-serif; max-width: 600px;">
              <h2 style="color: #10b981;">Slipway Test Notification</h2>
              <p>This is a test message from your Slipway instance.</p>
              <p>If you receive this, email notifications are working correctly.</p>
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
