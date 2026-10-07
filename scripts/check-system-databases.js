module.exports = {
  friendlyName: 'Check system databases',
  description:
    'Daily integrity verification on consistent snapshots, outside the web process.',
  quest: { cron: '0 3 * * *', withoutOverlapping: true },
  fn: async function () {
    return sails.helpers.system.checkDatabaseStorage()
  }
}
