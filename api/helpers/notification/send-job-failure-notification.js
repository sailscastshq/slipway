module.exports = {
  friendlyName: 'Send job failure notification',

  description: 'Send a notification when a Quest background job fails.',

  inputs: {
    jobName: {
      type: 'string',
      required: true
    },
    errorMessage: {
      type: 'string',
      required: true
    },
    duration: {
      type: 'number',
      description: 'Job duration in milliseconds'
    }
  },

  fn: async function ({ jobName, errorMessage, duration }) {
    const notifyOnJobFailure = await sails.helpers.setting.get('notifyOnJobFailure', 'true')
    if (notifyOnJobFailure !== 'true') {
      return
    }

    const instanceName = await sails.helpers.setting.get('instanceName', 'Slipway')

    const durationText = typeof duration === 'number' ? `${(duration / 1000).toFixed(1)}s` : 'N/A'

    // Send Telegram notification (HTML format)
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')
    if (telegramEnabled === 'true') {
      let message = `\u274C <b>A job didn't finish</b>\n\n`
      message += `<b>Job:</b> ${escapeHtml(jobName)}\n`
      message += `<b>Duration:</b> ${durationText}\n`
      message += `<b>Error:</b> ${escapeHtml(errorMessage)}\n`
      message += `\n<b>\u2014 Slippy \uD83D\uDC19, from ${escapeHtml(instanceName)}</b>`

      await sails.helpers.notification.sendTelegram.with({ message }).tolerate('error')
    }

    // Send Slack notification
    const slackEnabled = await sails.helpers.setting.get('slackEnabled', 'false')
    if (slackEnabled === 'true') {
      let message = `\u274C *A job didn't finish*\n\n`
      message += `*Job:* ${jobName}\n`
      message += `*Duration:* ${durationText}\n`
      message += `*Error:* ${errorMessage}\n`
      message += `\n*\u2014 Slippy \uD83D\uDC19, from ${instanceName}*`

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
              title: '\u274C A job didn\'t finish',
              color: 0xef4444,
              fields: [
                { name: 'Job', value: jobName, inline: true },
                { name: 'Duration', value: durationText, inline: true },
                { name: 'Error', value: errorMessage.substring(0, 1024) }
              ],
              footer: { text: `\u2014 Slippy \uD83D\uDC19, from ${instanceName}` },
              timestamp: new Date().toISOString()
            }]
          })
        }).catch(err => sails.log.warn('Discord job-failure notification failed:', err.message))
      }
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      await sails.helpers.notification.sendEmail.with({
        template: 'email-job-failure',
        subject: `\u274C A job didn't finish \u2014 ${jobName}`,
        templateData: {
          jobName,
          errorMessage,
          duration,
          instanceName
        }
      }).tolerate('error')
    }

    // Send webhook notification
    const webhookEnabled = await sails.helpers.setting.get('webhookEnabled', 'false')
    if (webhookEnabled === 'true') {
      await sails.helpers.notification.sendWebhook.with({
        event: 'quest.job_failed',
        data: {
          jobName,
          errorMessage,
          duration,
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
