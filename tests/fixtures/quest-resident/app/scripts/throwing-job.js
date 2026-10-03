module.exports = {
  friendlyName: 'Throw synthetic failure',
  fn: async function () {
    console.error('fixture-failure-warning')
    throw new Error('Synthetic business failure')
  }
}
