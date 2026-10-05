module.exports = {
  friendlyName: 'Coordinated upgrade status',
  inputs: { id: { type: 'string', required: true } },
  fn: async function (inputs) {
    return require('../../lib/system-upgrade-action').action(
      'status',
      this,
      inputs
    )
  }
}
