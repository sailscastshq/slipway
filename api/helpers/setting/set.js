/**
 * setting/set.js
 *
 * Sets a setting value in the database (upsert).
 * Usage: await sails.helpers.setting.set('instanceUrl', 'https://slipway.example.com')
 */

const SENSITIVE_KEYS = ['smtpPassword', 'telegramBotToken', 'discordWebhookUrl', 'slackWebhookUrl', 'webhookUrl', 'globalEnvVars']

module.exports = {
  friendlyName: 'Set setting',

  description: 'Set a setting value in the database.',

  inputs: {
    key: {
      type: 'string',
      required: true,
      description: 'The setting key'
    },
    value: {
      type: 'string',
      allowNull: true,
      description: 'The setting value'
    },
    description: {
      type: 'string',
      allowNull: true,
      description: 'Human-readable description'
    }
  },

  exits: {
    success: {
      description: 'Setting saved successfully.'
    }
  },

  fn: async function ({ key, value, description }) {
    const isSensitive = SENSITIVE_KEYS.includes(key)
    const existing = await Setting.findOne({ key })

    const updates = {
      // Sensitive keys go to encryptedValue (encrypted at rest), plain value is cleared
      ...(isSensitive ? { encryptedValue: value, value: null } : { value, encryptedValue: null }),
      ...(description && { description })
    }

    if (existing) {
      await Setting.updateOne({ key }).set(updates)
    } else {
      await Setting.create({ key, ...updates })
    }

    return true
  }
}
