module.exports = {
  friendlyName: 'Send email notification',

  description:
    'Fan an operational notification out to the configured recipients through the app mail boundary.',

  inputs: {
    template: {
      type: 'string',
      required: true,
      description: 'The email template name (e.g. deployment-notification)'
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

    const emails = [
      ...new Set(
        notificationEmails
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean)
          .map((email) => email.toLowerCase())
      )
    ]
    if (emails.length === 0) {
      throw 'error'
    }

    let failures = 0
    for (const to of emails) {
      try {
        await sails.helpers.mail.sendConfigured.with({
          to,
          subject,
          template,
          templateData
        })
      } catch {
        failures++
        sails.log.warn('Email notification recipient delivery failed')
      }
    }
    if (failures) throw 'error'
  }
}
