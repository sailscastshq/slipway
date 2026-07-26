module.exports = {
  friendlyName: 'Maintain observability',

  description:
    'Prune retained telemetry and check host disk health independently of Docker metrics.',

  quest: {
    interval: '5 minutes',
    withoutOverlapping: true
  },

  fn: async function () {
    await sails.helpers.lookout.runObservabilityMaintenance()
  }
}
