module.exports = {
  friendlyName: 'Apply coordinated upgrade',
  inputs: {
    approval: { type: 'string', required: true },
    instanceId: { type: 'string', required: true }
  },
  fn: async function (inputs) {
    return require('../../lib/system-upgrade-action').action(
      'apply',
      this,
      inputs
    )
  }
}
