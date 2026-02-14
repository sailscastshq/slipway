module.exports = {
  friendlyName: 'Send resource alert',

  description: 'Send a notification when a container exceeds CPU or memory thresholds.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    cpuPercent: {
      type: 'number',
      required: true
    },
    memoryPercent: {
      type: 'number',
      required: true
    },
    cpuHigh: {
      type: 'boolean',
      required: true
    },
    memHigh: {
      type: 'boolean',
      required: true
    }
  },

  fn: async function ({ containerName, cpuPercent, memoryPercent, cpuHigh, memHigh }) {
    // Check if resource alerts are enabled
    const notifyOnHighResourceUsage = await sails.helpers.setting.get('notifyOnHighResourceUsage', 'true')
    if (notifyOnHighResourceUsage !== 'true') {
      return
    }

    const instanceName = await sails.helpers.setting.get('instanceName', 'Slipway')

    const issues = []
    if (cpuHigh) issues.push(`CPU at ${cpuPercent.toFixed(1)}%`)
    if (memHigh) issues.push(`Memory at ${memoryPercent.toFixed(1)}%`)
    const issueText = issues.join(', ')

    // Send Telegram notification (HTML format)
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')
    if (telegramEnabled === 'true') {
      let message = `\u26A0\uFE0F <b>High Resource Usage</b>\n\n`
      message += `<b>Container:</b> ${escapeHtml(containerName)}\n`
      if (cpuHigh) {
        message += `<b>CPU:</b> ${cpuPercent.toFixed(1)}%\n`
      }
      if (memHigh) {
        message += `<b>Memory:</b> ${memoryPercent.toFixed(1)}%\n`
      }
      message += `\n<i>${escapeHtml(instanceName)}</i>`

      await sails.helpers.notification.sendTelegram.with({ message }).tolerate('error')
    }

    // Send Slack notification
    const slackEnabled = await sails.helpers.setting.get('slackEnabled', 'false')
    if (slackEnabled === 'true') {
      let message = `\u26A0\uFE0F *High Resource Usage*\n\n`
      message += `*Container:* ${containerName}\n`
      message += `*Issue:* ${issueText}\n`
      message += `\n_${instanceName}_`

      await sails.helpers.notification.sendSlack.with({ message }).tolerate('error')
    }

    // Send Discord notification
    const discordEnabled = await sails.helpers.setting.get('discordEnabled', 'false')
    if (discordEnabled === 'true') {
      const discordWebhookUrl = await sails.helpers.setting.get('discordWebhookUrl', '')
      if (discordWebhookUrl) {
        const fields = [
          { name: 'Container', value: containerName, inline: true }
        ]
        if (cpuHigh) {
          fields.push({ name: 'CPU', value: `${cpuPercent.toFixed(1)}%`, inline: true })
        }
        if (memHigh) {
          fields.push({ name: 'Memory', value: `${memoryPercent.toFixed(1)}%`, inline: true })
        }

        await fetch(discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '\u26A0\uFE0F High Resource Usage',
              color: 0xf59e0b,
              fields,
              footer: { text: instanceName },
              timestamp: new Date().toISOString()
            }]
          })
        }).catch(err => sails.log.warn('Discord resource alert failed:', err.message))
      }
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      await sails.helpers.notification.sendEmail.with({
        template: 'email-resource-alert',
        subject: `\u26A0\uFE0F High resource usage: ${containerName}`,
        templateData: {
          containerName,
          cpuPercent,
          memoryPercent,
          cpuHigh,
          memHigh,
          instanceName
        }
      }).tolerate('error')
    }

    // Send webhook notification
    const webhookEnabled = await sails.helpers.setting.get('webhookEnabled', 'false')
    if (webhookEnabled === 'true') {
      await sails.helpers.notification.sendWebhook.with({
        event: 'resource.high_usage',
        data: {
          containerName,
          cpuPercent,
          memoryPercent,
          cpuHigh,
          memHigh,
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
