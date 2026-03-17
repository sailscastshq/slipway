const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

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
    // Generate ED25519 keypair using ssh-keygen for native OpenSSH format.
    // Node's crypto.generateKeyPairSync produces PKCS8 PEM which some SSH
    // clients reject with "invalid format" for ED25519 keys.
    const keyFile = path.join(
      os.tmpdir(),
      `slipway-keygen-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )

    try {
      execFileSync(
        'ssh-keygen',
        [
          '-t',
          'ed25519',
          '-f',
          keyFile,
          '-N',
          '',
          '-C',
          `slipway-deploy-${repoName}`
        ],
        { timeout: 10_000 }
      )

      const privateKey = fs.readFileSync(keyFile, 'utf8')
      const publicKey = fs.readFileSync(`${keyFile}.pub`, 'utf8').trim()

      return { publicKey, privateKey }
    } finally {
      try {
        fs.unlinkSync(keyFile)
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(`${keyFile}.pub`)
      } catch {
        /* ignore */
      }
    }
  }
}
