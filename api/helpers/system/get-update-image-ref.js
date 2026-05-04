module.exports = {
  friendlyName: 'Get update image ref',

  description:
    'Resolve the exact Slipway Docker image ref for an advertised update.',

  inputs: {
    updateInfo: {
      type: 'ref',
      required: true,
      description: 'Update metadata returned by system.checkForUpdates.'
    },
    imageRepository: {
      type: 'string',
      required: true,
      description: 'Docker image repository without a tag.'
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ updateInfo, imageRepository }) {
    const targetVersion = String(updateInfo?.latestVersion || '')
      .trim()
      .replace(/^v/, '')

    if (!targetVersion) {
      throw new Error('Update check did not include a target version.')
    }

    return `${imageRepository}:${targetVersion}`
  }
}
