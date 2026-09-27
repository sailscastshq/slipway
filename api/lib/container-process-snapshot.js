const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const BRIDGE_WORKER_TITLE = 'slipway-bridge-worker'
const BRIDGE_WORKER_MARKER = '___SLIPWAY_BRIDGE_WORKER_RESULT___'
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

async function getContainerProcessSnapshot(
  containerName,
  dockerPath = 'docker'
) {
  const observedAt = Date.now()
  if (!CONTAINER_NAME.test(containerName)) return unavailable(observedAt)

  try {
    const { stdout } = await execFileAsync(
      dockerPath,
      ['top', containerName, '-eww', '-o', 'pid,rss,args'],
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    )
    return parseDockerTop(stdout, observedAt)
  } catch {
    // Docker errors can contain command lines. Never include them in a
    // diagnostic copied out of Slipway.
    return unavailable(observedAt)
  }
}

function parseDockerTop(output, observedAt = Date.now()) {
  const lines = output.trim().split(/\r?\n/)
  if (!/^\s*PID\s+RSS\s+(?:COMMAND|CMD|ARGS)\s*$/i.test(lines.shift() || '')) {
    return unavailable(observedAt)
  }

  let processCount = 0
  let bridgeWorkerCount = 0
  let bridgeWorkerRssKiB = 0

  for (const line of lines) {
    const match = line.match(/^\s*\d+\s+(\d+)\s+(.+)$/)
    if (!match) return unavailable(observedAt)
    processCount++
    if (
      match[2] === BRIDGE_WORKER_TITLE ||
      match[2].includes(BRIDGE_WORKER_MARKER)
    ) {
      bridgeWorkerCount++
      bridgeWorkerRssKiB += Number(match[1])
    }
  }

  return {
    available: true,
    observedAt,
    processCount,
    bridgeWorkerCount,
    bridgeWorkerRssMiB: Math.round((bridgeWorkerRssKiB / 1024) * 10) / 10
  }
}

function unavailable(observedAt) {
  return { available: false, observedAt }
}

module.exports = { getContainerProcessSnapshot, parseDockerTop }
