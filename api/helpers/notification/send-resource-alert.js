module.exports = {
  friendlyName: 'Send resource alert',

  description:
    'Send a notification when a container exceeds CPU or memory thresholds.',

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

  fn: async function ({
    containerName,
    cpuPercent,
    memoryPercent,
    cpuHigh,
    memHigh
  }) {
    // Check if resource alerts are enabled
    const notifyOnHighResourceUsage = await sails.helpers.setting.get(
      'notifyOnHighResourceUsage',
      'true'
    )
    if (notifyOnHighResourceUsage !== 'true') {
      return
    }

    const instanceName = await sails.helpers.setting.get(
      'instanceName',
      'Slipway'
    )

    const issues = []
    if (cpuHigh) issues.push(`CPU at ${cpuPercent.toFixed(1)}%`)
    if (memHigh) issues.push(`Memory at ${memoryPercent.toFixed(1)}%`)
    const issueText = issues.join(', ')

    // Send Telegram notification (HTML format)
    const telegramEnabled = await sails.helpers.setting.get(
      'telegramEnabled',
      'false'
    )
    if (telegramEnabled === 'true') {
      let message = `\u26A0\uFE0F <b>Things are heating up</b>\n\n`
      message += `<b>Container:</b> ${escapeHtml(containerName)}\n`
      if (cpuHigh) {
        message += `<b>CPU:</b> ${cpuPercent.toFixed(1)}%\n`
      }
      if (memHigh) {
        message += `<b>Memory:</b> ${memoryPercent.toFixed(1)}%\n`
      }
      message += `\nThis container is working up a sweat! Might be worth scaling up or investigating.\n`
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
      let message = `\u26A0\uFE0F *Things are heating up*\n\n`
      message += `*Container:* ${containerName}\n`
      message += `*Issue:* ${issueText}\n`
      message += `This container is working up a sweat! Might be worth scaling up or investigating.\n`
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
        const fields = [
          { name: 'Container', value: containerName, inline: true }
        ]
        if (cpuHigh) {
          fields.push({
            name: 'CPU',
            value: `${cpuPercent.toFixed(1)}%`,
            inline: true
          })
        }
        if (memHigh) {
          fields.push({
            name: 'Memory',
            value: `${memoryPercent.toFixed(1)}%`,
            inline: true
          })
        }

        await fetch(discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [
              {
                title: '\u26A0\uFE0F Things are heating up',
                description:
                  'This container is working up a sweat! Might be worth scaling up or investigating.',
                color: 0xf59e0b,
                fields,
                footer: {
                  text: `\u2014 Slippy \uD83D\uDC19, from ${instanceName}`
                },
                timestamp: new Date().toISOString()
              }
            ]
          })
        }).catch((err) =>
          sails.log.warn('Discord resource alert failed:', err.message)
        )
      }
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      await sails.helpers.notification.sendEmail
        .with({
          template: 'resource-alert',
          subject: `\u26A0\uFE0F Things are heating up \u2014 ${containerName}`,
          templateData: {
            containerName,
            cpuPercent,
            memoryPercent,
            cpuHigh,
            memHigh,
            instanceName
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
          event: 'resource.high_usage',
          data: {
            containerName,
            cpuPercent,
            memoryPercent,
            cpuHigh,
            memHigh,
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
