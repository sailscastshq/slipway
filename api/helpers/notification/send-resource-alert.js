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
    const notifyOnHighResource = await sails.helpers.setting.get('notifyOnHighResource', 'true')
    if (notifyOnHighResource !== 'true') {
      return
    }

    const instanceName = await sails.helpers.setting.get('instanceName', 'Slipway')

    const issues = []
    if (cpuHigh) issues.push(`CPU at ${cpuPercent.toFixed(1)}%`)
    if (memHigh) issues.push(`Memory at ${memoryPercent.toFixed(1)}%`)
    const issueText = issues.join(', ')

    // Send Telegram notification
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')
    if (telegramEnabled === 'true') {
      await sails.helpers.notification.sendTelegram({
        message: `⚠️ *High Resource Usage*\n\n*Container:* ${containerName}\n*Issue:* ${issueText}\n\n_${instanceName}_`
      }).tolerate('error')
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      await sails.helpers.notification.sendEmail({
        subject: `⚠️ High resource usage: ${containerName}`,
        text: `High resource usage detected on ${containerName}\n\n${issueText}\n\nSent from ${instanceName}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="padding: 20px; background: #f59e0b; color: white; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0; font-size: 18px;">High Resource Usage</h2>
            </div>
            <div style="padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Container</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500;">${containerName}</td>
                </tr>
                ${cpuHigh ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">CPU</td>
                  <td style="padding: 8px 0; color: #ef4444; font-size: 14px; font-weight: 500;">${cpuPercent.toFixed(1)}%</td>
                </tr>` : ''}
                ${memHigh ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Memory</td>
                  <td style="padding: 8px 0; color: #ef4444; font-size: 14px; font-weight: 500;">${memoryPercent.toFixed(1)}%</td>
                </tr>` : ''}
              </table>
            </div>
            <p style="margin-top: 20px; color: #9ca3af; font-size: 12px; text-align: center;">
              Sent from ${instanceName}
            </p>
          </div>
        `
      }).tolerate('error')
    }
  }
}
