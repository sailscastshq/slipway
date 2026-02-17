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

    const emoji = isSuccess ? '\u2705' : '\u274C'
    const statusText = isSuccess ? 'succeeded' : 'failed'
    const slippyTitle = isSuccess ? 'Ship shipped!' : 'Deployment hit a snag'
    const deploymentUrl = instanceDomain
      ? `https://${instanceDomain}/projects/${project.slug}/deployments/${deployment.id}`
      : null

    // Send Telegram notification (HTML format)
    const telegramEnabled = await sails.helpers.setting.get('telegramEnabled', 'false')
    if (telegramEnabled === 'true') {
      let message = `${emoji} <b>${slippyTitle}</b>\n\n`
      message += `<b>Project:</b> ${escapeHtml(project.name)}\n`
      message += `<b>Environment:</b> ${escapeHtml(environment.name)}\n`
      if (deployment.gitBranch) {
        message += `<b>Branch:</b> ${escapeHtml(deployment.gitBranch)}\n`
      }
      if (deployment.gitCommitShort) {
        message += `<b>Commit:</b> <code>${escapeHtml(deployment.gitCommitShort)}</code>\n`
      }
      if (deploymentUrl) {
        message += `\n<a href="${deploymentUrl}">View deployment</a>`
      }
      message += `\n\n<i>\u2014 Slippy, from ${escapeHtml(instanceName)}</i>`

      await sails.helpers.notification.sendTelegram.with({ message }).tolerate('error')
    }

    // Send Slack notification
    const slackEnabled = await sails.helpers.setting.get('slackEnabled', 'false')
    if (slackEnabled === 'true') {
      let message = `${emoji} *${slippyTitle}*\n\n`
      message += `*Project:* ${project.name}\n`
      message += `*Environment:* ${environment.name}\n`
      if (deployment.gitBranch) {
        message += `*Branch:* ${deployment.gitBranch}\n`
      }
      if (deployment.gitCommitShort) {
        message += `*Commit:* \`${deployment.gitCommitShort}\`\n`
      }
      if (deploymentUrl) {
        message += `\n<${deploymentUrl}|View deployment>`
      }
      message += `\n_\u2014 Slippy, from ${instanceName}_`

      await sails.helpers.notification.sendSlack.with({ message }).tolerate('error')
    }

    // Send Discord notification
    const discordEnabled = await sails.helpers.setting.get('discordEnabled', 'false')
    if (discordEnabled === 'true') {
      const discordWebhookUrl = await sails.helpers.setting.get('discordWebhookUrl', '')
      if (discordWebhookUrl) {
        const fields = [
          { name: 'Project', value: project.name, inline: true },
          { name: 'Environment', value: environment.name, inline: true }
        ]
        if (deployment.gitBranch) {
          fields.push({ name: 'Branch', value: deployment.gitBranch, inline: true })
        }
        if (deployment.gitCommitShort) {
          fields.push({ name: 'Commit', value: `\`${deployment.gitCommitShort}\``, inline: true })
        }

        await fetch(discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: `${emoji} ${slippyTitle}`,
              color: isSuccess ? 0x10b981 : 0xef4444,
              fields,
              ...(deploymentUrl ? { url: deploymentUrl } : {}),
              footer: { text: `\u2014 Slippy, from ${instanceName}` },
              timestamp: new Date().toISOString()
            }]
          })
        }).catch(err => sails.log.warn('Discord notification failed:', err.message))
      }
    }

    // Send email notification
    const smtpEnabled = await sails.helpers.setting.get('smtpEnabled', 'false')
    if (smtpEnabled === 'true') {
      await sails.helpers.notification.sendEmail.with({
        template: 'email-deployment-notification',
        subject: `${emoji} ${slippyTitle} \u2014 ${project.name} (${environment.name})`,
        templateData: {
          isSuccess,
          statusText,
          project,
          environment,
          deployment,
          instanceName,
          deploymentUrl
        }
      }).tolerate('error')
    }

    // Send webhook notification
    const webhookEnabled = await sails.helpers.setting.get('webhookEnabled', 'false')
    if (webhookEnabled === 'true') {
      await sails.helpers.notification.sendWebhook.with({
        event: isSuccess ? 'deployment.success' : 'deployment.failed',
        data: {
          project: { name: project.name, slug: project.slug },
          environment: { name: environment.name },
          deployment: {
            id: deployment.id,
            status: deployment.status,
            gitBranch: deployment.gitBranch,
            gitCommitShort: deployment.gitCommitShort
          },
          deploymentUrl,
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
