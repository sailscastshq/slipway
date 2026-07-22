const fs = require('node:fs/promises')

module.exports = {
  friendlyName: 'Get disk capacity',

  description:
    'Calculate how many bytes a bounded temporary operation may safely write.',

  inputs: {
    directory: {
      type: 'string',
      required: true
    },
    maxBytes: {
      type: 'number',
      required: true,
      min: 1
    },
    reserveBytes: {
      type: 'number',
      required: true,
      min: 0
    },
    expectedBytes: {
      type: 'number',
      min: 0
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ directory, maxBytes, reserveBytes, expectedBytes }) {
    const stats = await fs.statfs(directory)
    const availableBytes = Number(stats.bavail) * Number(stats.bsize)
    const writableBytes = Math.max(0, availableBytes - reserveBytes)
    const allowedBytes = Math.min(maxBytes, writableBytes)

    if (allowedBytes < 1) {
      const error = new Error(
        `Not enough temporary disk space. Slipway keeps ${formatBytes(
          reserveBytes
        )} free for the host.`
      )
      error.code = 'INSUFFICIENT_DISK_SPACE'
      throw error
    }

    if (expectedBytes !== undefined && expectedBytes > allowedBytes) {
      const error = new Error(
        `This operation needs ${formatBytes(
          expectedBytes
        )} of temporary disk space, but only ${formatBytes(
          allowedBytes
        )} is safely available.`
      )
      error.code = 'INSUFFICIENT_DISK_SPACE'
      error.expectedBytes = expectedBytes
      error.allowedBytes = allowedBytes
      throw error
    }

    return { availableBytes, allowedBytes, reserveBytes }
  }
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
