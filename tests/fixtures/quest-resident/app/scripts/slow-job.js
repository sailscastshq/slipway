module.exports = {
  friendlyName: 'Slow synthetic report',
  inputs: {
    label: { type: 'string', defaultsTo: 'scheduled' },
    delayMs: { type: 'number', defaultsTo: 7000, min: 0, max: 15000 }
  },
  fn: async function (inputs) {
    const probe = require('../lib/probe')
    probe('business:start', { name: 'slow-job', inputs })
    await new Promise((resolve) => setTimeout(resolve, inputs.delayMs))
    probe('business:finish', { name: 'slow-job', inputs })
    return { finished: true, label: inputs.label }
  }
}
