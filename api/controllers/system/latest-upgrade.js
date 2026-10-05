module.exports = {
  friendlyName: 'Latest coordinated upgrade',
  inputs: {},
  fn: async function () {
    return require('../../lib/system-upgrade-action').action('latest', this, {})
  }
}
