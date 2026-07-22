const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Get container stats',

  description: 'Get resource usage stats for all running Docker containers.',

  inputs: {},

  exits: {
    success: {
      description: 'Stats retrieved for all running containers',
      outputType: 'ref'
    }
  },

  fn: async function () {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    try {
      const { stdout } = await execFileAsync(dockerPath, [
        'stats',
        '--no-stream',
        '--format',
        '{{json .}}'
      ])

      if (!stdout.trim()) {
        return []
      }

      const results = []
      const lines = stdout.trim().split('\n')

      for (const line of lines) {
        try {
          const raw = JSON.parse(line)
          results.push({
            name: raw.Name,
            cpuPercent: parsePercent(raw.CPUPerc),
            memUsage: parseBytes(raw.MemUsage?.split('/')[0]?.trim()),
            memLimit: parseBytes(raw.MemUsage?.split('/')[1]?.trim()),
            memPercent: parsePercent(raw.MemPerc),
            netIO: raw.NetIO || null,
            blockIO: raw.BlockIO || null,
            pids: parseInt(raw.PIDs, 10) || null
          })
        } catch (parseErr) {
          sails.log.verbose('Lookout: Failed to parse docker stats line:', line)
        }
      }

      return results
    } catch (err) {
      if (err.code === 'ENOENT') {
        sails.log.warn('Lookout: Docker binary not found at', dockerPath)
      } else {
        sails.log.verbose('Lookout: docker stats error:', err.message)
      }

      // A command failure is not an authoritative empty sample. Let the caller
      // skip this metrics cycle without changing lifecycle state.
      throw err
    }
  }
}

/**
 * Parse a percentage string like "2.45%" into a number (2.45)
 */
function parsePercent(str) {
  if (!str) return 0
  return parseFloat(str.replace('%', '')) || 0
}

/**
 * Parse a human-readable byte string like "150.3MiB" into bytes.
 */
function parseBytes(str) {
  if (!str) return 0
  str = str.trim()
  const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)$/)
  if (!match) return 0

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  const multipliers = {
    b: 1,
    kib: 1024,
    kb: 1024,
    mib: 1024 * 1024,
    mb: 1024 * 1024,
    gib: 1024 * 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    tib: 1024 * 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024
  }

  return Math.round(value * (multipliers[unit] || 1))
}
