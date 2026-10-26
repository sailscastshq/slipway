module.exports = {
  friendlyName: 'Archive update backups',
  description:
    'Resume optional private archival of retained updater snapshots after server restarts.',
  quest: { interval: '5 minutes', withoutOverlapping: true },
  fn: async function () {
    return sails.helpers.system.archiveUpdateBackup()
  }
}
