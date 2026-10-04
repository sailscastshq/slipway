module.exports = {
  friendlyName: 'Return typed value',
  inputs: { value: { type: 'json' } },
  fn: async function ({ value }) {
    return value
  }
}
