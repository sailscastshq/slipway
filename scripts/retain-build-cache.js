module.exports = {
  friendlyName: 'Clean up old build cache',
  description:
    'Remove unused Docker build cache older than seven days with a retained storage target and shared build admission.',
  inputs: { preview: { type: 'boolean', defaultsTo: false } },
  quest: { cron: '17 * * * *', withoutOverlapping: true },
  fn: async function ({ preview = false } = {}) {
    return sails.helpers.buildCacheRetention.run.with({ preview })
  }
}
