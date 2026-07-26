const fs = require('node:fs/promises')
const path = require('node:path')

module.exports = {
  friendlyName: 'Remove retained source',

  description:
    'Remove a project source snapshot only when it is inside Slipway’s apps directory.',

  inputs: {
    sourcePath: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ sourcePath }) {
    const root = path.resolve(sails.config.custom.slipwayAppsDir)
    const target = path.resolve(sourcePath)
    const isOwned = target !== root && target.startsWith(`${root}${path.sep}`)

    if (!isOwned) {
      throw new Error(`Refusing to remove source outside ${root}`)
    }

    await fs.rm(target, { recursive: true, force: true })
    return { removed: true, sourcePath: target }
  }
}
