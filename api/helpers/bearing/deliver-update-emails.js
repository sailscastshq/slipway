module.exports = {
  friendlyName: 'Deliver Bearing update emails',
  inputs: { batchSize: { type: 'number', defaultsTo: 10, min: 1, max: 50 } },
  fn: async function (inputs) {
    return require('../../lib/bearing-mail-queue').drain(inputs)
  }
}
