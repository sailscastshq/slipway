const path = require('node:path')
const fs = require('node:fs')

module.exports = function gitSshCommand(keyFile) {
  const knownHosts =
    process.env.SLIPWAY_GIT_KNOWN_HOSTS ||
    path.resolve(__dirname, '../../config/git_known_hosts')
  if (!path.isAbsolute(knownHosts) || !fs.statSync(knownHosts).isFile()) {
    throw new Error(
      'SLIPWAY_GIT_KNOWN_HOSTS must point to an absolute trusted known_hosts file.'
    )
  }
  // Git evaluates GIT_SSH_COMMAND through a shell. Quote every argument,
  // including paths containing spaces, quotes, or shell metacharacters.
  return [
    'ssh',
    '-F',
    '/dev/null',
    '-i',
    keyFile,
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'IdentityAgent=none',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `UserKnownHostsFile="${knownHosts.replace(/([\\"])/g, '\\$1')}"`,
    '-o',
    'GlobalKnownHostsFile=/dev/null'
  ]
    .map((arg) => `'${arg.replace(/'/g, `'"'"'`)}'`)
    .join(' ')
}
