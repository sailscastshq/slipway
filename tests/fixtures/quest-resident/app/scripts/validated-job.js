module.exports = {
  friendlyName: 'Validate even number',
  inputs: {
    even: {
      type: 'number',
      required: true,
      custom: (value) => Number.isInteger(value) && value % 2 === 0
    }
  },
  fn: async function (inputs) {
    require('../lib/probe')('business:start', { name: 'validated-job', inputs })
    return { validated: inputs.even }
  }
}
