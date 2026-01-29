/**
 * setting/get.js
 *
 * Gets a setting value from the database with optional default.
 * Usage: await sails.helpers.setting.get('instanceUrl')
 */

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
    try {
      const setting = await Setting.findOne({ key })
      if (setting && setting.value !== null) {
        return setting.value
      }
    } catch (err) {
      sails.log.verbose(`Could not read setting "${key}":`, err.message)
    }

    return defaultValue || null
  }
}
