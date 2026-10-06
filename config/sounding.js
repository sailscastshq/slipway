const nativeFixture = process.env.SLIPWAY_TEST_NATIVE_CONFIG
  ? JSON.parse(
      require('node:fs').readFileSync(
        process.env.SLIPWAY_TEST_NATIVE_CONFIG,
        'utf8'
      )
    )
  : null
const nativeOptions = nativeFixture
  ? { datastores: nativeFixture.datastores, models: { migrate: 'safe' } }
  : {}

module.exports.sounding = {
  ...(nativeFixture ? { datastore: { mode: 'inherit' } } : {}),
  app: {
    loadOptions: nativeOptions,
    liftOptions: {
      ...nativeOptions,
      explicitHost: '127.0.0.1',
      hooks: {
        sockets: true
      }
    }
  },
  browser: {
    projects: [
      {
        name: 'desktop'
      },
      {
        name: 'mobile',
        device: 'iPhone 13'
      }
    ],
    defaultProject: 'desktop'
  }
}
