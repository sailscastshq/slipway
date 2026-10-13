module.exports = {
  friendlyName: 'Deliver Bearing update emails',
  quest: { interval: '1 minute', withoutOverlapping: true },
  fn: async function () {
    await sails.helpers.bearing.deliverUpdateEmails()
  }
}
