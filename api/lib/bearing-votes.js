const crypto = require('node:crypto')

function voteKey(feedbackId, identityKey) {
  return crypto
    .createHash('sha256')
    .update(`${String(feedbackId)}:${String(identityKey)}`)
    .digest('hex')
}

function anonymousIdentity(visitorId, secret) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(String(visitorId || ''))
    .digest('hex')
}

module.exports = { anonymousIdentity, voteKey }
