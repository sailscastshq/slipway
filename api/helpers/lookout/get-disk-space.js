const { execFile } = require('child_process')
const util = require('util')

const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Get disk space',

  description: 'Read the current host disk usage for the root volume.',

  inputs: {},

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function () {
    try {
      const { stdout } = await execFileAsync('df', ['-kP', '/'])
      return parseDiskSpaceOutput(stdout)
    } catch (err) {
      if (err.code === 'ENOENT') {
        sails.log.warn('Lookout: df binary not found')
        return null
      }

      sails.log.verbose('Lookout: Disk space read error:', err.message)
      return null
    }
  }
}

function parseDiskSpaceOutput(stdout) {
  const lines = String(stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)

  if (lines.length < 2) {
    throw new Error('Unexpected df output')
  }

  const parts = lines[1].trim().split(/\s+/)
  if (parts.length < 6) {
    throw new Error('Unexpected df output')
  }

  const totalBytes = parseInt(parts[1], 10) * 1024
  const usedBytes = parseInt(parts[2], 10) * 1024
  const availableBytes = parseInt(parts[3], 10) * 1024
  const usedPercent = parseInt(parts[4].replace('%', ''), 10)
  const mount = parts.slice(5).join(' ') || '/'

  if (
    !Number.isFinite(totalBytes) ||
    !Number.isFinite(usedBytes) ||
    !Number.isFinite(availableBytes) ||
    !Number.isFinite(usedPercent)
  ) {
    throw new Error('Unexpected df output')
  }

  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent,
    total: formatBytes(totalBytes),
    used: formatBytes(usedBytes),
    available: formatBytes(availableBytes),
    mount
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

module.exports._private = {
  parseDiskSpaceOutput,
  formatBytes
}
