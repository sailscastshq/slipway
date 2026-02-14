module.exports = {
  friendlyName: 'Send container down alert',

  description: 'Send a notification when a container is detected as down.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    resourceType: {
      type: 'string',
      required: true,
      isIn: ['app', 'service']
    }
  },

  fn: async function ({ containerName, resourceType }) {
    const notifyOnContainerDown = await sails.helpers.setting.get('notifyOnContainerDown', 'true')
    if (notifyOnContainerDown !== 'true') {
      return
    }

    const instanceName = await sails.helpers.setting.get('instanceName', 'Slipway')

    // Send Telegram notification (HTML format)
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')
    if (telegramEnabled === 'true') {
      let message = `\uD83D\uDD34 <b>Container Down</b>\n\n`
      message += `<b>Container:</b> ${escapeHtml(containerName)}\n`
      message += `<b>Type:</b> ${escapeHtml(resourceType)}\n`
      message += `<b>Status:</b> Stopped unexpectedly\n`
      message += `\n<i>${escapeHtml(instanceName)}</i>`

      await sails.helpers.notification.sendTelegram.with({ message }).tolerate('error')
    }

    // Send Slack notification
    const slackEnabled = await sails.helpers.setting.get('slackEnabled', 'false')
    if (slackEnabled === 'true') {
      let message = `\uD83D\uDD34 *Container Down*\n\n`
      message += `*Container:* ${containerName}\n`
      message += `*Type:* ${resourceType}\n`
      message += `*Status:* Stopped unexpectedly\n`
      message += `\n_${instanceName}_`

      await sails.helpers.notification.sendSlack.with({ message }).tolerate('error')
    }

    // Send Discord notification
    const discordEnabled = await sails.helpers.setting.get('discordEnabled', 'false')
    if (discordEnabled === 'true') {
      const discordWebhookUrl = await sails.helpers.setting.get('discordWebhookUrl', '')
      if (discordWebhookUrl) {
        await fetch(discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '\uD83D\uDD34 Container Down',
              color: 0xef4444,
              fields: [
                { name: 'Container', value: containerName, inline: true },
                { name: 'Type', value: resourceType, inline: true },
                { name: 'Status', value: 'Stopped unexpectedly', inline: true }
              ],
              footer: { text: instanceName },
              timestamp: new Date().toISOString()
            }]
          })
        }).catch(err => sails.log.warn('Discord container-down alert failed:', err.message))
      }
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      await sails.helpers.notification.sendEmail.with({
        template: 'email-container-down',
        subject: `\uD83D\uDD34 Container down: ${containerName}`,
        templateData: {
          containerName,
          resourceType,
          instanceName
        }
      }).tolerate('error')
    }

    // Send webhook notification
    const webhookEnabled = await sails.helpers.setting.get('webhookEnabled', 'false')
    if (webhookEnabled === 'true') {
      await sails.helpers.notification.sendWebhook.with({
        event: 'container.down',
        data: {
          containerName,
          resourceType,
          instanceName
        }
      }).tolerate('error')
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
