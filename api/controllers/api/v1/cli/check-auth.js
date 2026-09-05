module.exports = {
  friendlyName: 'Check CLI auth',
  inputs: { deviceCode: { type: 'string', required: true, maxLength: 64 } },
  exits: { success: {}, notFound: { statusCode: 404 } },
  fn: async function ({ deviceCode }) {
    const result = sails.helpers.cli.authSessions().readDevice(deviceCode)
    if (!result) throw 'notFound'
    this.res.set('Cache-Control', 'no-store')
    return result
  }
}
