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

    // Discord
    discordWebhookUrl: {
      type: 'string'
    },
    discordEnabled: {
      type: 'boolean'
    },

    // Slack
    slackWebhookUrl: {
      type: 'string'
    },
    slackEnabled: {
      type: 'boolean'
    },

    // Webhook
    webhookUrl: {
      type: 'string'
    },
    webhookEnabled: {
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

    // Preferences - Deployment
    notifyOnDeploySuccess: {
      type: 'boolean'
    },
    notifyOnDeployFailure: {
      type: 'boolean'
    },

    // Preferences - Backup
    notifyOnBackupSuccess: {
      type: 'boolean'
    },
    notifyOnBackupFailure: {
      type: 'boolean'
    },

    // Preferences - System
    notifyOnContainerRestart: {
      type: 'boolean'
    },
    notifyOnHighResourceUsage: {
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

    // Discord settings
    if (inputs.discordWebhookUrl !== undefined) {
      await sails.helpers.setting.set('discordWebhookUrl', inputs.discordWebhookUrl.trim())
    }
    if (inputs.discordEnabled !== undefined) {
      await sails.helpers.setting.set('discordEnabled', String(inputs.discordEnabled))
    }

    // Slack settings
    if (inputs.slackWebhookUrl !== undefined) {
      await sails.helpers.setting.set('slackWebhookUrl', inputs.slackWebhookUrl.trim())
    }
    if (inputs.slackEnabled !== undefined) {
      await sails.helpers.setting.set('slackEnabled', String(inputs.slackEnabled))
    }

    // Webhook settings
    if (inputs.webhookUrl !== undefined) {
      await sails.helpers.setting.set('webhookUrl', inputs.webhookUrl.trim())
    }
    if (inputs.webhookEnabled !== undefined) {
      await sails.helpers.setting.set('webhookEnabled', String(inputs.webhookEnabled))
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

    // Preferences - Deployment
    if (inputs.notifyOnDeploySuccess !== undefined) {
      await sails.helpers.setting.set('notifyOnDeploySuccess', String(inputs.notifyOnDeploySuccess))
    }
    if (inputs.notifyOnDeployFailure !== undefined) {
      await sails.helpers.setting.set('notifyOnDeployFailure', String(inputs.notifyOnDeployFailure))
    }

    // Preferences - Backup
    if (inputs.notifyOnBackupSuccess !== undefined) {
      await sails.helpers.setting.set('notifyOnBackupSuccess', String(inputs.notifyOnBackupSuccess))
    }
    if (inputs.notifyOnBackupFailure !== undefined) {
      await sails.helpers.setting.set('notifyOnBackupFailure', String(inputs.notifyOnBackupFailure))
    }

    // Preferences - System
    if (inputs.notifyOnContainerRestart !== undefined) {
      await sails.helpers.setting.set('notifyOnContainerRestart', String(inputs.notifyOnContainerRestart))
    }
    if (inputs.notifyOnHighResourceUsage !== undefined) {
      await sails.helpers.setting.set('notifyOnHighResourceUsage', String(inputs.notifyOnHighResourceUsage))
    }

    this.req._sails.inertia.flash('success', 'Notification settings updated')
    return '/settings/notifications'
  }
}
