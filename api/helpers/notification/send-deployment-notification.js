module.exports = {
  friendlyName: 'Send deployment notification',

  description: 'Send a notification about a deployment to configured channels.',

  inputs: {
    deployment: {
      type: 'ref',
      required: true,
      description: 'The deployment record'
    },
    project: {
      type: 'ref',
      required: true,
      description: 'The project record'
    },
    environment: {
      type: 'ref',
      required: true,
      description: 'The environment record'
    }
  },

  fn: async function ({ deployment, project, environment }) {
    const status = deployment.status
    const isSuccess = status === 'running' || status === 'success'
    const isFailure = status === 'failed'

    // Check notification preferences
    const notifyOnSuccess = await sails.helpers.setting.get('notifyOnDeploySuccess', 'true')
    const notifyOnFailure = await sails.helpers.setting.get('notifyOnDeployFailure', 'true')

    if (isSuccess && notifyOnSuccess !== 'true') {
      return
    }
    if (isFailure && notifyOnFailure !== 'true') {
      return
    }
    if (!isSuccess && !isFailure) {
      return // Only notify on final states
    }

    const instanceName = await sails.helpers.setting.get('instanceName', 'Slipway')
    const instanceDomain = await sails.helpers.setting.get('instanceDomain', '')

    const emoji = isSuccess ? '✅' : '❌'
    const statusText = isSuccess ? 'succeeded' : 'failed'
    const deploymentUrl = instanceDomain
      ? `https://${instanceDomain}/projects/${project.slug}/deployments/${deployment.id}`
      : null

    // Send Telegram notification
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')
    if (telegramEnabled === 'true') {
      await sails.helpers.notification.sendTelegram({
        message: formatTelegramMessage({
          emoji,
          statusText,
          project,
          environment,
          deployment,
          instanceName,
          deploymentUrl
        })
      }).tolerate('error')
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      await sails.helpers.notification.sendEmail({
        subject: `${emoji} Deployment ${statusText}: ${project.name} (${environment.name})`,
        text: formatEmailText({
          statusText,
          project,
          environment,
          deployment,
          instanceName,
          deploymentUrl
        }),
        html: formatEmailHtml({
          isSuccess,
          statusText,
          project,
          environment,
          deployment,
          instanceName,
          deploymentUrl
        })
      }).tolerate('error')
    }
  }
}

function formatTelegramMessage({ emoji, statusText, project, environment, deployment, instanceName, deploymentUrl }) {
  let message = `${emoji} *Deployment ${statusText}*\n\n`
  message += `*Project:* ${project.name}\n`
  message += `*Environment:* ${environment.name}\n`

  if (deployment.gitBranch) {
    message += `*Branch:* ${deployment.gitBranch}\n`
  }
  if (deployment.gitCommitShort) {
    message += `*Commit:* \`${deployment.gitCommitShort}\`\n`
  }

  if (deploymentUrl) {
    message += `\n[View deployment](${deploymentUrl})`
  }

  return message
}

function formatEmailText({ statusText, project, environment, deployment, instanceName, deploymentUrl }) {
  let text = `Deployment ${statusText}\n\n`
  text += `Project: ${project.name}\n`
  text += `Environment: ${environment.name}\n`

  if (deployment.gitBranch) {
    text += `Branch: ${deployment.gitBranch}\n`
  }
  if (deployment.gitCommitShort) {
    text += `Commit: ${deployment.gitCommitShort}\n`
  }

  if (deploymentUrl) {
    text += `\nView deployment: ${deploymentUrl}`
  }

  return text
}

function formatEmailHtml({ isSuccess, statusText, project, environment, deployment, instanceName, deploymentUrl }) {
  const statusColor = isSuccess ? '#10b981' : '#ef4444'

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="padding: 20px; background: ${statusColor}; color: white; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">Deployment ${statusText}</h2>
      </div>
      <div style="padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Project</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500;">${project.name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Environment</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500;">${environment.name}</td>
          </tr>
          ${deployment.gitBranch ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Branch</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500;">${deployment.gitBranch}</td>
          </tr>
          ` : ''}
          ${deployment.gitCommitShort ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Commit</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-family: monospace;">${deployment.gitCommitShort}</td>
          </tr>
          ` : ''}
        </table>
        ${deploymentUrl ? `
        <div style="margin-top: 20px;">
          <a href="${deploymentUrl}" style="display: inline-block; padding: 10px 20px; background: #111827; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;">View Deployment</a>
        </div>
        ` : ''}
      </div>
      <p style="margin-top: 20px; color: #9ca3af; font-size: 12px; text-align: center;">
        Sent from ${instanceName}
      </p>
    </div>
  `
}
