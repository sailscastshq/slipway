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

    // Send Telegram notification
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')
    if (telegramEnabled === 'true') {
      await sails.helpers.notification.sendTelegram.with({
        message: `🔴 *Container Down*\n\n*Container:* ${containerName}\n*Type:* ${resourceType}\n*Status:* Stopped unexpectedly\n\n_${instanceName}_`
      }).tolerate('error')
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      await sails.helpers.notification.sendEmail.with({
        subject: `🔴 Container down: ${containerName}`,
        text: `Container ${containerName} (${resourceType}) has stopped unexpectedly.\n\nSent from ${instanceName}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="padding: 20px; background: #ef4444; color: white; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0; font-size: 18px;">Container Down</h2>
            </div>
            <div style="padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Container</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500;">${containerName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Type</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500;">${resourceType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Status</td>
                  <td style="padding: 8px 0; color: #ef4444; font-size: 14px; font-weight: 500;">Stopped unexpectedly</td>
                </tr>
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
