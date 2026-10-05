module.exports = {
  friendlyName: 'Plan coordinated upgrade',
  inputs: {},
  fn: async function () {
    return require('../../lib/system-upgrade-action').action('plan', this, {})
  }
}
