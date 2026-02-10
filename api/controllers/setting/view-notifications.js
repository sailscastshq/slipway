module.exports = {
  friendlyName: 'View notifications settings',

  description: 'Display the notifications settings page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    // Telegram settings
    const telegramBotToken = await sails.helpers.setting.get('telegramBotToken', '')
    const telegramChatId = await sails.helpers.setting.get('telegramChatId', '')
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')

    // SMTP settings
    const smtpHost = await sails.helpers.setting.get('smtpHost', '')
    const smtpPort = await sails.helpers.setting.get('smtpPort', '587')
    const smtpUser = await sails.helpers.setting.get('smtpUser', '')
    const smtpFrom = await sails.helpers.setting.get('smtpFrom', '')
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')

    // Email recipients
    const notificationEmails = await sails.helpers.setting.get('notificationEmails', '')

    // Notification preferences
    const notifyOnDeploySuccess = await sails.helpers.setting.get('notifyOnDeploySuccess', 'true')
    const notifyOnDeployFailure = await sails.helpers.setting.get('notifyOnDeployFailure', 'true')

    return {
      page: 'settings/notifications',
      props: {
        telegram: {
          botToken: telegramBotToken,
          chatId: telegramChatId,
          enabled: telegramEnabled === 'true'
        },
        smtp: {
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          from: smtpFrom,
          enabled: smtpEnabled === 'true'
        },
        notificationEmails,
        preferences: {
          deploySuccess: notifyOnDeploySuccess === 'true',
          deployFailure: notifyOnDeployFailure === 'true'
        }
      }
    }
  }
}
