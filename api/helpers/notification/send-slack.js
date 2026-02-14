module.exports = {
  friendlyName: 'Send Slack message',

  description: 'Send a message via Slack incoming webhook.',

  inputs: {
    message: {
      type: 'string',
      required: true,
      description: 'The message to send (Slack mrkdwn format)'
    }
  },

  exits: {
    error: {
      description: 'Failed to send Slack message'
    }
  },

  fn: async function ({ message }) {
    const webhookUrl = await sails.helpers.setting.get('slackWebhookUrl', '')

    if (!webhookUrl) {
      throw 'error'
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message })
      })

      if (!response.ok) {
        const text = await response.text()
        sails.log.warn('Slack notification failed:', text)
        throw 'error'
      }
    } catch (err) {
      if (err === 'error') throw err
      sails.log.warn('Slack notification failed:', err.message || err)
      throw 'error'
    }
  }
}
