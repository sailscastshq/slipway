const crypto = require('crypto')

module.exports = {
  friendlyName: 'Generate telemetry token',

  description:
    'Generate a telemetry token and its SHA-256 hash for an environment.',

  sync: true,

  fn: function () {
    const token = 'stk_' + crypto.randomBytes(24).toString('hex')
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    return { telemetryToken: token, telemetryTokenHash: hash }
  }
}
