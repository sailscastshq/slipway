const {
  deliveryKey,
  resourceAlertMessage
} = require('../../lib/resource-alert-message')

module.exports = {
  friendlyName: 'Send resource alert',
  description:
    'Deliver pending resource warnings and acknowledge each successful destination separately.',
  inputs: {
    containerName: { type: 'string', required: true },
    cpuPercent: { type: 'number', required: true },
    memoryPercent: { type: 'number', required: true },
    memoryUsage: { type: 'number', required: true },
    memoryLimit: { type: 'number', required: true },
    cpuHigh: { type: 'boolean', required: true },
    memHigh: { type: 'boolean', required: true },
    observedAt: { type: 'number', required: true },
    targetLabel: { type: 'string' },
    lookoutUrl: { type: 'string' },
    incidentKey: { type: 'string', required: true },
    receipts: { type: 'ref', defaultsTo: {} },
    deliveryAttempt: { type: 'number', defaultsTo: 0 },
    onDelivered: { type: 'ref', required: true }
  },
  fn: async function (inputs) {
    const get = (key, fallback = '') => sails.helpers.setting.get(key, fallback)
    if ((await get('notifyOnHighResourceUsage', 'true')) !== 'true')
      return { outcome: 'disabled', attempted: 0 }
    const message = resourceAlertMessage({
      ...inputs,
      instanceName: await get('instanceName', 'Slipway')
    })
    const targets = []
    let waitingForChannel = false
    const smtpEnabled = (await get('smtpEnabled', 'false')) === 'true'
    const emails = [
      ...new Set(
        (await get('notificationEmails'))
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
      )
    ]
    if (!smtpEnabled && emails.length) waitingForChannel = true
    if (smtpEnabled) {
      if (!emails.length) waitingForChannel = true
      for (const to of emails)
        targets.push({
          key: deliveryKey('email', to),
          send: () =>
            sails.helpers.mail.sendConfigured.with({
              to,
              subject: message.subject,
              template: 'resource-alert',
              templateData: message,
              waitForAcknowledgement: true,
              headers: {
                'Message-ID':
                  '<' + deliveryKey(inputs.incidentKey, to) + '@slipway.local>'
              }
            })
        })
    }
    for (const channel of ['telegram', 'slack', 'discord', 'webhook']) {
      const enabled = (await get(channel + 'Enabled', 'false')) === 'true'
      const destination =
        channel === 'telegram'
          ? (await get('telegramBotToken')) +
            ':' +
            (await get('telegramChatId')) +
            ':' +
            (await get('telegramThreadId'))
          : await get(
              channel === 'webhook' ? 'webhookUrl' : channel + 'WebhookUrl'
            )
      const configured = !(
        !destination ||
        (channel === 'telegram' &&
          (!(await get('telegramBotToken')) || !(await get('telegramChatId'))))
      )
      if (!enabled) {
        if (configured) waitingForChannel = true
        continue
      }
      if (!configured) {
        waitingForChannel = true
        continue
      }
      targets.push({
        key: deliveryKey(channel, destination),
        send: async () => {
          if (channel === 'discord') {
            const response = await fetch(destination, {
              method: 'POST',
              signal: AbortSignal.timeout(10000),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                embeds: [
                  {
                    title: message.title,
                    description: message.summary,
                    color: 0xf59e0b,
                    fields: inputs.lookoutUrl
                      ? [{ name: 'Lookout', value: inputs.lookoutUrl }]
                      : []
                  }
                ]
              })
            })
            if (!response.ok) throw new Error('DELIVERY_FAILED')
          } else if (channel === 'webhook')
            await sails.helpers.notification.sendWebhook.with({
              event: 'resource.high_usage',
              data: {
                containerName: inputs.containerName,
                cpuPercent: inputs.cpuPercent,
                memoryPercent: inputs.memoryPercent,
                memoryUsage: inputs.memoryUsage,
                memoryLimit: inputs.memoryLimit,
                cpuHigh: inputs.cpuHigh,
                memHigh: inputs.memHigh,
                observedAt: inputs.observedAt,
                lookoutUrl: inputs.lookoutUrl
              }
            })
          else if (channel === 'slack')
            await sails.helpers.notification.sendSlack.with({
              message: message.summary + '\n' + (inputs.lookoutUrl || '')
            })
          else
            await sails.helpers.notification.sendTelegram.with({
              message: escapeHtml(
                message.summary + '\n' + (inputs.lookoutUrl || '')
              )
            })
        }
      })
    }
    if (!targets.length) return { outcome: 'unconfigured', attempted: 0 }
    const pending = targets.filter((target) => !inputs.receipts[target.key])
    let attempted = 0
    let failures = 0
    // Rotate the bounded batch so repeated failures cannot starve later recipients.
    const start = pending.length
      ? (inputs.deliveryAttempt * 3) % pending.length
      : 0
    const batch = [...pending.slice(start), ...pending.slice(0, start)].slice(
      0,
      3
    )
    for (const target of batch) {
      attempted++
      let timer
      try {
        // Persist acknowledgements before the next recipient. Late SMTP
        // acknowledgement remains valid while the queue lease is held.
        const sending = Promise.resolve()
          .then(target.send)
          .then(() => inputs.onDelivered(target.key))
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(new Error('DELIVERY_UNCONFIRMED'), {
                  code: 'DELIVERY_UNCONFIRMED'
                })
              ),
            60000
          )
        })
        await Promise.race([sending, deadline])
      } catch (error) {
        if (error.code === 'DELIVERY_UNCONFIRMED')
          return { outcome: 'unconfirmed', attempted }
        failures++
        sails.log.warn(
          'Lookout: Resource alert destination failed; retry scheduled'
        )
      } finally {
        clearTimeout(timer)
      }
    }
    return {
      outcome: failures
        ? 'failed'
        : pending.length > 3
        ? 'remaining'
        : waitingForChannel
        ? 'disabled-or-unconfigured-channel'
        : 'sent',
      attempted
    }
  }
}
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
