const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Send configured mail',

  description:
    'Sync UI-backed SMTP settings, then send mail through sails-hook-mail.',

  inputs: {
    mailer: {
      type: 'string'
    },
    template: {
      type: 'string'
    },
    templateData: {
      type: 'ref',
      defaultsTo: {}
    },
    attachments: {
      type: 'ref',
      defaultsTo: []
    },
    to: {
      type: 'string',
      required: true,
      isEmail: true
    },
    toName: {
      type: 'string'
    },
    subject: {
      type: 'string',
      defaultsTo: ''
    },
    from: {
      type: 'string',
      isEmail: true
    },
    fromName: {
      type: 'string'
    },
    layout: {
      defaultsTo: 'mail',
      custom: (layout) => layout === false || typeof layout === 'string'
    },
    waitForAcknowledgement: {
      type: 'boolean',
      defaultsTo: false
    },
    text: {
      type: 'string'
    },
    replyTo: {
      type: 'string',
      isEmail: true
    },
    cc: {
      type: 'ref',
      defaultsTo: []
    },
    bcc: {
      type: 'ref',
      defaultsTo: []
    },
    headers: {
      type: 'ref',
      defaultsTo: {}
    },
    templateUuid: {
      type: 'string'
    },
    templateVariables: {
      type: 'ref'
    },
    category: {
      type: 'string'
    },
    customVariables: {
      type: 'ref'
    },
    testInboxId: {
      type: 'string'
    },
    react: {
      type: 'string'
    },
    scheduledAt: {
      type: 'string'
    }
  },

  fn: async function (inputs) {
    await sails.helpers.setting.syncSmtpConfig()

    const message = {
      ...inputs,
      mailer: getConfiguredMailer(inputs.mailer),
      from: inputs.from || sails.config.mail.from.address,
      fromName: inputs.fromName || sails.config.mail.from.name
    }

    for (const key of Object.keys(message)) {
      if (message[key] === undefined) {
        delete message[key]
      }
    }

    return sails.helpers.mail.send.with(message)
  }
}

function getConfiguredMailer(mailer) {
  const resolvedMailer =
    mailer || process.env.MAIL_MAILER || sails.config.mail.default
  const mailerConfig = sails.config.mail.mailers[resolvedMailer]

  if (!mailerConfig || mailerConfig.transport !== 'smtp') {
    return resolvedMailer
  }

  const smtpConfig = {
    transport: mailerConfig.transport,
    host: mailerConfig.host || process.env.MAIL_HOST || '',
    port: mailerConfig.port || process.env.MAIL_PORT || '',
    secure: mailerConfig.secure || process.env.MAIL_SECURE || false,
    username: mailerConfig.username || process.env.MAIL_USERNAME || '',
    password: mailerConfig.password || process.env.MAIL_PASSWORD || ''
  }
  const digest = crypto
    .createHash('sha1')
    .update(JSON.stringify(smtpConfig))
    .digest('hex')
    .slice(0, 12)
  const configuredMailer = `${resolvedMailer}-${digest}`

  sails.config.mail.mailers[configuredMailer] = {
    ...mailerConfig
  }

  return configuredMailer
}
