const crypto = require('crypto')

module.exports = {
  friendlyName: 'Ensure Bridge app secret',

  description:
    'Return the dedicated Bridge exchange credential for an app, creating it when necessary.',

  inputs: {
    appId: {
      type: 'string',
      required: true
    },
    rotate: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: {
      outputType: 'string'
    },
    notFound: {}
  },

  fn: async function ({ appId, rotate }) {
    let app = await App.findOne({ id: appId }).decrypt()
    if (!app) throw 'notFound'
    if (app.bridgeSecret && !rotate) return app.bridgeSecret

    const bridgeSecret = `slb_${crypto.randomBytes(32).toString('base64url')}`
    await App.updateOne({ id: app.id }).set({ bridgeSecret })

    app = await App.findOne({ id: app.id }).decrypt()
    return app.bridgeSecret
  }
}
