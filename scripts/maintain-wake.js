module.exports = {
  friendlyName: 'Maintain Wake history',
  description:
    'Bound raw and aggregate analytics retention and remove deleted app data.',
  quest: { interval: '5 minutes', withoutOverlapping: true },
  fn: async function () {
    // Quest loads a fresh console app without running the web bootstrap.
    // Use the same release-schema validation before touching retained data.
    if (!sails.wakeStorageReady) await sails.helpers.wake.ensureSchema()
    const store = require('../api/lib/wake-store')
    store.maintain()
    const apps = new Set(
      (await App.find({}).select(['id'])).map((app) => String(app.id))
    )
    const retained = store
      .database()
      .prepare(
        'SELECT DISTINCT app FROM wake_health UNION SELECT DISTINCT app FROM wake_receipts UNION SELECT DISTINCT app FROM wake_connections'
      )
      .all()
    for (const { app } of retained) if (!apps.has(app)) store.deleteApp(app)
  }
}
