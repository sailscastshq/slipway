const crypto = require('node:crypto')
const purpose = Buffer.from('slipway:cleanup:backup-storage:v1')
function key(id) {
  return Buffer.from(sails.config.models.dataEncryptionKeys[id], 'base64')
}
module.exports = {
  seal(config) {
    const keyId = 'default'
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key(keyId), iv)
    cipher.setAAD(purpose)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(config)),
      cipher.final()
    ])
    return {
      keyId,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64')
    }
  },
  open(value) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key(value.keyId),
        Buffer.from(value.iv, 'base64')
      )
      decipher.setAAD(purpose)
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(value.ciphertext, 'base64')),
          decipher.final()
        ]).toString()
      )
    } catch {
      throw new Error(
        'The retained backup storage credentials could not be decrypted. Restore the original encryption key before retrying cleanup.'
      )
    }
  }
}
