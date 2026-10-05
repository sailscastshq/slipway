module.exports = {
  friendlyName: 'Resume coordinated upgrade',
  inputs: {
    id: { type: 'string', required: true },
    approval: { type: 'string', required: true },
    instanceId: { type: 'string', required: true }
  },
  fn: async function (inputs) {
    return require('../../lib/system-upgrade-action').action(
      'resume',
      this,
      inputs
    )
  }
}
