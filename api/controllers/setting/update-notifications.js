module.exports = {
  friendlyName: 'Update notifications settings',

  description: 'Update notification configuration.',

  inputs: {
    // Telegram
    telegramBotToken: {
      type: 'string'
    },
    telegramChatId: {
      type: 'string'
    },
    telegramEnabled: {
      type: 'boolean'
    },

    // SMTP
    smtpHost: {
      type: 'string'
    },
    smtpPort: {
      type: 'string'
    },
    smtpUser: {
      type: 'string'
    },
    smtpPassword: {
      type: 'string'
    },
    smtpFrom: {
      type: 'string'
    },
    smtpEnabled: {
      type: 'boolean'
    },

    // Email recipients
    notificationEmails: {
      type: 'string'
    },

    // Preferences
    notifyOnDeploySuccess: {
      type: 'boolean'
    },
    notifyOnDeployFailure: {
      type: 'boolean'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    }
  },

  fn: async function (inputs) {
    // Telegram settings
    if (inputs.telegramBotToken !== undefined) {
      await sails.helpers.setting.set('telegramBotToken', inputs.telegramBotToken.trim())
    }
    if (inputs.telegramChatId !== undefined) {
      await sails.helpers.setting.set('telegramChatId', inputs.telegramChatId.trim())
    }
    if (inputs.telegramEnabled !== undefined) {
      await sails.helpers.setting.set('telegramEnabled', String(inputs.telegramEnabled))
    }

    // SMTP settings
    if (inputs.smtpHost !== undefined) {
      await sails.helpers.setting.set('smtpHost', inputs.smtpHost.trim())
    }
    if (inputs.smtpPort !== undefined) {
      await sails.helpers.setting.set('smtpPort', inputs.smtpPort.trim())
    }
    if (inputs.smtpUser !== undefined) {
      await sails.helpers.setting.set('smtpUser', inputs.smtpUser.trim())
    }
    if (inputs.smtpPassword !== undefined && inputs.smtpPassword !== '') {
      // Only update password if provided (don't clear it)
      await sails.helpers.setting.set('smtpPassword', inputs.smtpPassword)
    }
    if (inputs.smtpFrom !== undefined) {
      await sails.helpers.setting.set('smtpFrom', inputs.smtpFrom.trim())
    }
    if (inputs.smtpEnabled !== undefined) {
      await sails.helpers.setting.set('smtpEnabled', String(inputs.smtpEnabled))
    }

    // Email recipients
    if (inputs.notificationEmails !== undefined) {
      await sails.helpers.setting.set('notificationEmails', inputs.notificationEmails.trim())
    }

    // Preferences
    if (inputs.notifyOnDeploySuccess !== undefined) {
      await sails.helpers.setting.set('notifyOnDeploySuccess', String(inputs.notifyOnDeploySuccess))
    }
    if (inputs.notifyOnDeployFailure !== undefined) {
      await sails.helpers.setting.set('notifyOnDeployFailure', String(inputs.notifyOnDeployFailure))
    }

    this.req._sails.inertia.flash('success', 'Notification settings updated')
    return '/settings/notifications'
  }
}
