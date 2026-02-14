/**
 * setting/get.js
 *
 * Gets a setting value from the database with optional default.
 * Usage: await sails.helpers.setting.get('instanceUrl')
 */

const SENSITIVE_KEYS = ['smtpPassword', 'telegramBotToken', 'discordWebhookUrl', 'slackWebhookUrl', 'webhookUrl', 'globalEnvVars']

module.exports = {
  friendlyName: 'Get setting',

  description: 'Get a setting value from the database.',

  inputs: {
    key: {
      type: 'string',
      required: true,
      description: 'The setting key to retrieve'
    },
    defaultValue: {
      type: 'string',
      allowNull: true,
      description: 'Default value if setting not found'
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ key, defaultValue }) {
    // Check cache first (cache-aside pattern)
    const cacheKey = `setting:${key}`
    try {
      const cached = await sails.cache.get(cacheKey)
      if (cached !== null && cached !== undefined) {
        return cached === '__null__' ? (defaultValue || null) : cached
      }
    } catch (err) {
      sails.log.verbose(`Cache read failed for "${key}":`, err.message)
    }

    try {
      const setting = await Setting.findOne({ key }).decrypt()
      if (setting) {
        let result
        if (SENSITIVE_KEYS.includes(key) && setting.encryptedValue !== null && setting.encryptedValue !== undefined) {
          result = setting.encryptedValue
        } else if (setting.value !== null) {
          result = setting.value
        }

        if (result !== undefined) {
          try { await sails.cache.set(cacheKey, result, 900_000) } catch (err) { /* best-effort */ }
          return result
        }
      }
      // Cache the miss so we don't keep querying DB for non-existent keys
      try { await sails.cache.set(cacheKey, '__null__', 900_000) } catch (err) { /* best-effort */ }
    } catch (err) {
      sails.log.verbose(`Could not read setting "${key}":`, err.message)
    }

    return defaultValue || null
  }
}
