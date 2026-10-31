module.exports = {
  friendlyName: 'Run queued source checks',
  description: 'Execute bounded checks-only CI without creating a deployment.',
  quest: { interval: '1 minute', withoutOverlapping: true },
  fn: async function () {
    await sails.helpers.ci.runQueuedChecks()
  }
}
