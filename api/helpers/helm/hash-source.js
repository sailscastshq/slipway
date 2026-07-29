const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Hash Helm source',

  description:
    'Return the SHA-256 digest used to bind write arms and identify protected Helm source in audit events.',

  inputs: {
    source: {
      type: 'string',
      required: true
    }
  },

  sync: true,

  fn: function ({ source }) {
    return crypto.createHash('sha256').update(source).digest('hex')
  }
}
