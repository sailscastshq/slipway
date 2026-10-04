module.exports = {
  friendlyName: 'Protect synthetic input',
  inputs: { accessCode: { type: 'string', required: true, sensitive: true } },
  fn: async function ({ accessCode }) {
    console.log('synthetic protected input: ' + accessCode)
    console.error('synthetic warning: ' + accessCode)
    return { observed: accessCode, publicCount: 12 }
  }
}
