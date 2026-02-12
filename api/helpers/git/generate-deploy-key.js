const crypto = require('crypto')

module.exports = {
  friendlyName: 'Generate Deploy Key',

  description: 'Generate an SSH keypair for repository access.',

  inputs: {
    repoName: {
      type: 'string',
      required: true,
      description: 'Repository name for key comment'
    }
  },

  fn: async function ({ repoName }) {
    // Generate ED25519 keypair using Node.js crypto
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    })

    // Convert to OpenSSH format
    const publicKeyBuffer = crypto.createPublicKey(publicKey).export({
      type: 'spki',
      format: 'der'
    })

    // ED25519 public key is last 32 bytes of SPKI DER
    const keyData = publicKeyBuffer.slice(-32)
    const sshPublicKey = `ssh-ed25519 ${Buffer.concat([
      Buffer.from([0, 0, 0, 11]), // length of "ssh-ed25519"
      Buffer.from('ssh-ed25519'),
      Buffer.from([0, 0, 0, 32]), // length of key data
      keyData
    ]).toString('base64')} slipway-deploy-${repoName}`

    // Convert private key to OpenSSH format
    // Node's PKCS8 PEM works with ssh, but we'll keep it simple
    const sshPrivateKey = privateKey

    return {
      publicKey: sshPublicKey,
      privateKey: sshPrivateKey
    }
  }
}
