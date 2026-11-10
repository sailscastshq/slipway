const page = require('../../lib/beacon/public-page')
module.exports = {
  friendlyName: 'Beacon public config',
  inputs: { apps: { type: 'ref', required: true } },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ apps }) {
    if (!apps.length) return []
    const settings = await Setting.find({
      key: apps.map((app) => page.key(app.id))
    })
    const values = new Map(
      settings.map((setting) => [setting.key, page.enabled(setting.value)])
    )
    return apps.map((app) => ({
      ...app,
      beaconPublicEnabled: Object.hasOwn(app, 'beaconPublicEnabled')
        ? app.beaconPublicEnabled === true
        : values.get(page.key(app.id)) === true
    }))
  }
}
