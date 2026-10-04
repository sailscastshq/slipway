module.exports = {
  friendlyName: 'Synthetic telemetry burst result',
  inputs: { label: { type: 'string', required: true, maxLength: 80 } },
  fn: async function ({ label }) {
    require('../lib/probe')('business:start', {
      name: 'telemetry-burst',
      label
    })
    return { label, payload: 'x'.repeat(16000) }
  }
}
