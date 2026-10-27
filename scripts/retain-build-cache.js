module.exports = {
  friendlyName: 'Clean up old build cache',
  description:
    'Remove unused Docker build cache older than seven days with a retained storage target and shared build admission.',
  inputs: {
    preview: { type: 'boolean', defaultsTo: false },
    requestId: { type: 'string', regex: /^[a-f0-9-]{36}$/ }
  },
  quest: { cron: '17 * * * *', withoutOverlapping: true },
  fn: async function ({ preview = false, requestId } = {}) {
    return sails.helpers.buildCacheRetention.run.with({ preview, requestId })
  }
}
