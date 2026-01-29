/**
 * setting/set.js
 *
 * Sets a setting value in the database (upsert).
 * Usage: await sails.helpers.setting.set('instanceUrl', 'https://slipway.example.com')
 */

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
    const existing = await Setting.findOne({ key })

    if (existing) {
      await Setting.updateOne({ key }).set({
        value,
        ...(description && { description })
      })
    } else {
      await Setting.create({
        key,
        value,
        description
      })
    }

    return true
  }
}
