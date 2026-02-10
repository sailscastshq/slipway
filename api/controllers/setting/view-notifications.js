module.exports = {
  friendlyName: 'View notifications settings',

  description: 'Display the notifications settings page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    // Get global env vars
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch { /* ignore */ }

    // Telegram settings
    const telegramBotToken = await sails.helpers.setting.get('telegramBotToken', '')
    const telegramChatId = await sails.helpers.setting.get('telegramChatId', '')
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')

    // Discord settings
    const discordWebhookUrl = await sails.helpers.setting.get('discordWebhookUrl', '')
    const discordEnabled = await sails.helpers.setting.get('discordEnabled', 'false')

    // SMTP settings - prefer global env vars, fall back to stored settings
    const smtpHost = globalEnvVars.MAIL_HOST || await sails.helpers.setting.get('smtpHost', '')
    const smtpPort = globalEnvVars.MAIL_PORT || await sails.helpers.setting.get('smtpPort', '587')
    const smtpUser = globalEnvVars.MAIL_USER || await sails.helpers.setting.get('smtpUser', '')
    const smtpFrom = globalEnvVars.MAIL_FROM || await sails.helpers.setting.get('smtpFrom', '')
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')

    // Check if SMTP is configured via env vars
    const smtpFromEnv = !!(globalEnvVars.MAIL_HOST || globalEnvVars.MAIL_USER)

    // Email recipients
    const notificationEmails = await sails.helpers.setting.get('notificationEmails', '')

    // Notification preferences - deployment
    const notifyOnDeploySuccess = await sails.helpers.setting.get('notifyOnDeploySuccess', 'true')
    const notifyOnDeployFailure = await sails.helpers.setting.get('notifyOnDeployFailure', 'true')

    // Notification preferences - backup
    const notifyOnBackupSuccess = await sails.helpers.setting.get('notifyOnBackupSuccess', 'false')
    const notifyOnBackupFailure = await sails.helpers.setting.get('notifyOnBackupFailure', 'true')

    // Notification preferences - system
    const notifyOnContainerRestart = await sails.helpers.setting.get('notifyOnContainerRestart', 'false')
    const notifyOnHighResourceUsage = await sails.helpers.setting.get('notifyOnHighResourceUsage', 'false')

    return {
      page: 'settings/notifications',
      props: {
        telegram: {
          botToken: telegramBotToken,
          chatId: telegramChatId,
          enabled: telegramEnabled === 'true'
        },
        discord: {
          webhookUrl: discordWebhookUrl,
          enabled: discordEnabled === 'true'
        },
        smtp: {
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          from: smtpFrom,
          enabled: smtpEnabled === 'true',
          fromEnv: smtpFromEnv,
          hasPassword: !!(globalEnvVars.MAIL_PASSWORD || await sails.helpers.setting.get('smtpPassword', ''))
        },
        notificationEmails,
        preferences: {
          deploySuccess: notifyOnDeploySuccess === 'true',
          deployFailure: notifyOnDeployFailure === 'true',
          backupSuccess: notifyOnBackupSuccess === 'true',
          backupFailure: notifyOnBackupFailure === 'true',
          containerRestart: notifyOnContainerRestart === 'true',
          highResourceUsage: notifyOnHighResourceUsage === 'true'
        }
      }
    }
  }
}
