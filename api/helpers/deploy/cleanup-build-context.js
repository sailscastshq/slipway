const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

module.exports = {
  friendlyName: 'Cleanup build context',

  description:
    'Remove a deployment-owned temporary build context without touching persistent source.',

  inputs: {
    contextPath: {
      type: 'string',
      required: true
    },
    deploymentId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ contextPath, deploymentId }) {
    const ownedRoot = path.resolve(
      os.tmpdir(),
      'slipway',
      'deployments',
      String(deploymentId)
    )
    const resolved = path.resolve(contextPath)
    const isOwned =
      resolved === ownedRoot || resolved.startsWith(`${ownedRoot}${path.sep}`)

    if (!isOwned) return { removed: false }

    fs.rmSync(resolved, { recursive: true, force: true })
    return { removed: true }
  }
}
