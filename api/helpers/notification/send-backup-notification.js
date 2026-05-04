module.exports = {
  friendlyName: 'Send backup notification',

  description:
    'Send a notification about a backup result to configured channels.',

  inputs: {
    backup: {
      type: 'ref',
      required: true,
      description: 'The backup record'
    },
    service: {
      type: 'ref',
      required: true,
      description: 'The service record'
    }
  },

  fn: async function ({ backup, service }) {
    const isSuccess = backup.status === 'completed'
    const isFailure = backup.status === 'failed'

    if (!isSuccess && !isFailure) {
      return
    }

    // Check notification preferences
    const notifyOnSuccess = await sails.helpers.setting.get(
      'notifyOnBackupSuccess',
      'false'
    )
    const notifyOnFailure = await sails.helpers.setting.get(
      'notifyOnBackupFailure',
      'true'
    )

    if (isSuccess && notifyOnSuccess !== 'true') {
      return
    }
    if (isFailure && notifyOnFailure !== 'true') {
      return
    }

    // Resolve environment and project for context
    let environmentName = ''
    let projectName = ''
    const envId =
      typeof service.environment === 'object'
        ? service.environment.id
        : service.environment
    if (envId) {
      const environment = await Environment.findOne({ id: envId }).populate(
        'project'
      )
      if (environment) {
        environmentName = environment.name
        if (environment.project) {
          projectName = environment.project.name
        }
      }
    }

    const instanceName = await sails.helpers.setting.get(
      'instanceName',
      'Slipway'
    )
    const emoji = isSuccess ? '\u2705' : '\u274C'
    const slippyTitle = isSuccess
      ? 'Backup safe and sound'
      : "Backup didn't make it"

    // Format duration
    const duration = backup.durationMs
      ? `${(backup.durationMs / 1000).toFixed(1)}s`
      : 'N/A'

    // Format size
    const size = backup.sizeBytes ? formatBytes(backup.sizeBytes) : 'N/A'

    // Send Telegram notification
    const telegramEnabled = await sails.helpers.setting.get(
      'telegramEnabled',
      'false'
    )
    if (telegramEnabled === 'true') {
      let message = `${emoji} <b>${slippyTitle}</b>\n\n`
      if (projectName) message += `<b>Project:</b> ${escapeHtml(projectName)}\n`
      if (environmentName)
        message += `<b>Environment:</b> ${escapeHtml(environmentName)}\n`
      message += `<b>Service:</b> ${escapeHtml(service.name)}\n`
      message += `<b>Type:</b> ${escapeHtml(service.type)}\n`
      message += `<b>Duration:</b> ${duration}\n`
      if (isSuccess) {
        message += `<b>Size:</b> ${size}\n`
      }
      if (isFailure && backup.errorMessage) {
        message += `<b>Error:</b> ${escapeHtml(backup.errorMessage)}\n`
      }
      message += `\n<b>\u2014 Slippy \uD83D\uDC19, from ${escapeHtml(
        instanceName
      )}</b>`

      await sails.helpers.notification.sendTelegram
        .with({ message })
        .tolerate('error')
    }

    // Send Slack notification
    const slackEnabled = await sails.helpers.setting.get(
      'slackEnabled',
      'false'
    )
    if (slackEnabled === 'true') {
      let message = `${emoji} *${slippyTitle}*\n\n`
      if (projectName) message += `*Project:* ${projectName}\n`
      if (environmentName) message += `*Environment:* ${environmentName}\n`
      message += `*Service:* ${service.name}\n`
      message += `*Type:* ${service.type}\n`
      message += `*Duration:* ${duration}\n`
      if (isSuccess) {
        message += `*Size:* ${size}\n`
      }
      if (isFailure && backup.errorMessage) {
        message += `*Error:* ${backup.errorMessage}\n`
      }
      message += `\n*\u2014 Slippy \uD83D\uDC19, from ${instanceName}*`

      await sails.helpers.notification.sendSlack
        .with({ message })
        .tolerate('error')
    }

    // Send Discord notification
    const discordEnabled = await sails.helpers.setting.get(
      'discordEnabled',
      'false'
    )
    if (discordEnabled === 'true') {
      const discordWebhookUrl = await sails.helpers.setting.get(
        'discordWebhookUrl',
        ''
      )
      if (discordWebhookUrl) {
        const fields = []
        if (projectName)
          fields.push({ name: 'Project', value: projectName, inline: true })
        if (environmentName)
          fields.push({
            name: 'Environment',
            value: environmentName,
            inline: true
          })
        fields.push(
          { name: 'Service', value: service.name, inline: true },
          { name: 'Type', value: service.type, inline: true },
          { name: 'Duration', value: duration, inline: true }
        )
        if (isSuccess) {
          fields.push({ name: 'Size', value: size, inline: true })
        }
        if (isFailure && backup.errorMessage) {
          fields.push({
            name: 'Error',
            value: backup.errorMessage,
            inline: false
          })
        }

        await fetch(discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [
              {
                title: `${emoji} ${slippyTitle}`,
                color: isSuccess ? 0x10b981 : 0xef4444,
                fields,
                footer: {
                  text: `\u2014 Slippy \uD83D\uDC19, from ${instanceName}`
                },
                timestamp: new Date().toISOString()
              }
            ]
          })
        }).catch((err) =>
          sails.log.warn('Discord backup notification failed:', err.message)
        )
      }
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      const subjectSuffix = environmentName
        ? `${service.name} (${environmentName})`
        : service.name
      await sails.helpers.notification.sendEmail
        .with({
          template: 'backup-notification',
          layout: 'mail',
          subject: `${emoji} ${slippyTitle} \u2014 ${subjectSuffix}`,
          templateData: {
            isSuccess,
            backup,
            service,
            projectName,
            environmentName,
            instanceName,
            errorMessage: backup.errorMessage || ''
          }
        })
        .tolerate('error')
    }

    // Send webhook notification
    const webhookEnabled = await sails.helpers.setting.get(
      'webhookEnabled',
      'false'
    )
    if (webhookEnabled === 'true') {
      await sails.helpers.notification.sendWebhook
        .with({
          event: isSuccess ? 'backup.success' : 'backup.failed',
          data: {
            project: projectName || undefined,
            environment: environmentName || undefined,
            service: { name: service.name, type: service.type },
            backup: {
              id: backup.id,
              status: backup.status,
              durationMs: backup.durationMs,
              sizeBytes: backup.sizeBytes,
              errorMessage: backup.errorMessage
            },
            instanceName
          }
        })
        .tolerate('error')
    }
  }
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
