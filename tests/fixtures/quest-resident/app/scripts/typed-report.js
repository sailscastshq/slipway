module.exports = {
  friendlyName: 'Typed report',
  inputs: {
    count: { type: 'number', defaultsTo: 7 },
    enabled: { type: 'boolean', defaultsTo: true },
    label: { type: 'string', defaultsTo: 'default', allowNull: true },
    payload: { type: 'json', defaultsTo: { omitted: true } }
  },
  fn: async function (inputs) {
    require('../lib/probe')('business:start', { name: 'typed-report', inputs })
    return inputs
  }
}
