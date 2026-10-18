module.exports = {
  friendlyName: 'Retain deployment images',

  description:
    'Plan conservative retention of old deployment images; removal is disabled by default.',

  quest: {
    interval: '24 hours',
    withoutOverlapping: true
  },

  fn: async function () {
    return sails.helpers.imageRetention.run()
  }
}
