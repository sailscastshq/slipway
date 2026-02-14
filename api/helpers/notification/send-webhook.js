module.exports = {
  friendlyName: 'Send webhook notification',

  description: 'Send a notification via generic webhook (POST JSON).',

  inputs: {
    event: {
      type: 'string',
      required: true,
      description: 'The event type (e.g. deployment.success, backup.failed)'
    },
    data: {
      type: 'ref',
      defaultsTo: {},
      description: 'The event data payload'
    }
  },

  exits: {
    error: {
      description: 'Failed to send webhook'
    }
  },

  fn: async function ({ event, data }) {
    const url = await sails.helpers.setting.get('webhookUrl', '')

    if (!url) {
      throw 'error'
    }

    try {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const text = await response.text()
        sails.log.warn('Webhook notification failed:', text)
        throw 'error'
      }
    } catch (err) {
      if (err === 'error') throw err
      sails.log.warn('Webhook notification failed:', err.message || err)
      throw 'error'
    }
  }
}
