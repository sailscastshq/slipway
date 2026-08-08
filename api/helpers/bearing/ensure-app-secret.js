const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Ensure Bearing app secret',

  description:
    'Create or rotate the private app-scoped Bearing exchange credential.',

  inputs: {
    appId: { type: 'string', required: true },
    rotate: { type: 'boolean', defaultsTo: false }
  },

  exits: {
    success: { outputType: 'string' },
    notFound: { description: 'The app does not exist.' }
  },

  fn: async function ({ appId, rotate }) {
    const app = await App.findOne({ id: appId }).decrypt()
    if (!app) throw 'notFound'
    if (app.bearingSecret && !rotate) return app.bearingSecret

    const bearingSecret = `slr_${crypto.randomBytes(32).toString('base64url')}`
    await App.updateOne({ id: app.id }).set({ bearingSecret })
    return bearingSecret
  }
}
