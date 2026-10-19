module.exports = {
  friendlyName: 'Clean up deployment images',

  description:
    'Remove eligible old app deployment images while protecting running work and recovery references.',

  inputs: { preview: { type: 'boolean', defaultsTo: false } },

  quest: {
    interval: '24 hours',
    withoutOverlapping: true
  },

  fn: async function ({ preview = false } = {}) {
    const result = await sails.helpers.imageRetention.run.with({ preview })
    return result.summary
  }
}
