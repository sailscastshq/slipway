module.exports = {
  friendlyName: 'Send email notification',

  description: 'Send an email notification to configured recipients.',

  inputs: {
    template: {
      type: 'string',
      required: true,
      description:
        'The email template name (e.g. email-deployment-notification)'
    },
    subject: {
      type: 'string',
      required: true
    },
    templateData: {
      type: 'ref',
      defaultsTo: {}
    }
  },

  exits: {
    error: {
      description: 'Failed to send email'
    }
  },

  fn: async function ({ template, subject, templateData }) {
    const notificationEmails = await sails.helpers.setting.get(
      'notificationEmails',
      ''
    )

    if (!notificationEmails) {
      throw 'error'
    }

    const emails = notificationEmails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
    if (emails.length === 0) {
      throw 'error'
    }

    try {
      await sails.helpers.setting.syncSmtpConfig()
      const fromAddress = sails.config.mail.from.address
      const fromName = sails.config.mail.from.name

      for (const to of emails) {
        await sails.helpers.mail.send.with({
          to,
          from: fromAddress,
          fromName,
          subject,
          template,
          templateData
        })
      }
    } catch (err) {
      sails.log.warn('Email notification failed:', err.message || err)
      throw 'error'
    }
  }
}
