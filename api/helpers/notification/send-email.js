module.exports = {
  friendlyName: 'Send email notification',

  description: 'Send an email to notification recipients.',

  inputs: {
    subject: {
      type: 'string',
      required: true
    },
    text: {
      type: 'string',
      required: true
    },
    html: {
      type: 'string'
    }
  },

  exits: {
    error: {
      description: 'Failed to send email'
    }
  },

  fn: async function ({ subject, text, html }) {
    const smtpHost = await sails.helpers.setting.get('smtpHost', '')
    const smtpPort = await sails.helpers.setting.get('smtpPort', '587')
    const smtpUser = await sails.helpers.setting.get('smtpUser', '')
    const smtpPassword = await sails.helpers.setting.get('smtpPassword', '')
    const smtpFrom = await sails.helpers.setting.get('smtpFrom', '')
    const notificationEmails = await sails.helpers.setting.get('notificationEmails', '')

    if (!smtpHost || !notificationEmails) {
      throw 'error'
    }

    const emails = notificationEmails.split(',').map(e => e.trim()).filter(Boolean)
    if (emails.length === 0) {
      throw 'error'
    }

    try {
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

      await transporter.sendMail({
        from: smtpFrom || smtpUser || 'slipway@localhost',
        to: emails.join(', '),
        subject,
        text,
        html: html || undefined
      })
    } catch (err) {
      sails.log.warn('Email notification failed:', err.message || err)
      throw 'error'
    }
  }
}
