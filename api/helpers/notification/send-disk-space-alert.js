module.exports = {
  friendlyName: 'Send disk space alert',

  description: 'Send a notification when host disk usage exceeds threshold.',

  inputs: {
    usedPercent: {
      type: 'number',
      required: true
    },
    availableGb: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ usedPercent, availableGb }) {
    const notifyOnHighResourceUsage = await sails.helpers.setting.get(
      'notifyOnHighResourceUsage',
      'true'
    )
    if (notifyOnHighResourceUsage !== 'true') return

    const instanceName = await sails.helpers.setting.get(
      'instanceName',
      'Slipway'
    )

    const telegramEnabled = await sails.helpers.setting.get(
      'telegramEnabled',
      'false'
    )
    if (telegramEnabled === 'true') {
      let message = `\u26A0\uFE0F <b>Disk space is running low</b>\n\n`
      message += `<b>Used:</b> ${usedPercent}%\n`
      message += `<b>Available:</b> ${escapeHtml(availableGb)}\n`
      message += `\nYour server is filling up. Consider cleaning up old images, pruning Docker, or expanding your disk.\n`
      message += `\n<b>\u2014 Slippy \uD83D\uDC19, from ${escapeHtml(
        instanceName
      )}</b>`
      await sails.helpers.notification.sendTelegram
        .with({ message })
        .tolerate('error')
    }

    const slackEnabled = await sails.helpers.setting.get(
      'slackEnabled',
      'false'
    )
    if (slackEnabled === 'true') {
      let message = `\u26A0\uFE0F *Disk space is running low*\n\n`
      message += `*Used:* ${usedPercent}%\n`
      message += `*Available:* ${availableGb}\n`
      message += `Your server is filling up. Consider cleaning up old images, pruning Docker, or expanding your disk.\n`
      message += `\n*\u2014 Slippy \uD83D\uDC19, from ${instanceName}*`
      await sails.helpers.notification.sendSlack
        .with({ message })
        .tolerate('error')
    }

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
        await fetch(discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [
              {
                title: '\u26A0\uFE0F Disk space is running low',
                description:
                  'Your server is filling up. Consider cleaning up old images, pruning Docker, or expanding your disk.',
                color: 0xef4444,
                fields: [
                  { name: 'Used', value: `${usedPercent}%`, inline: true },
                  { name: 'Available', value: availableGb, inline: true }
                ],
                footer: {
                  text: `\u2014 Slippy \uD83D\uDC19, from ${instanceName}`
                },
                timestamp: new Date().toISOString()
              }
            ]
          })
        }).catch((err) =>
          sails.log.warn('Discord disk alert failed:', err.message)
        )
      }
    }

    const webhookEnabled = await sails.helpers.setting.get(
      'webhookEnabled',
      'false'
    )
    if (webhookEnabled === 'true') {
      await sails.helpers.notification.sendWebhook
        .with({
          event: 'disk.low_space',
          data: { usedPercent, availableGb, instanceName }
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
