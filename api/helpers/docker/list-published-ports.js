const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { isIP } = require('node:net')

const execute = promisify(execFile)

module.exports = {
  friendlyName: 'List published ports',
  description: 'Read occupied TCP port numbers from the Docker host.',
  inputs: {},
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    try {
      const { stdout } = await execute(
        sails.config.docker?.binaryPath || 'docker',
        ['container', 'ls', '--format', '{{json .Ports}}'],
        { timeout: 15000, maxBuffer: 1024 * 1024 }
      )
      return parsePublishedPorts(stdout)
    } catch (cause) {
      throw new Error(
        'Could not inspect Docker host ports. Verify Docker daemon access and retry; no port was reserved.',
        { cause }
      )
    }
  }
}

function parsePublishedPorts(stdout) {
  const ports = new Set()
  for (const line of stdout.split('\n').filter((line) => line.trim())) {
    const mappings = JSON.parse(line)
    if (typeof mappings !== 'string') {
      throw new Error('Invalid Docker published port response')
    }
    for (const entry of mappings.split(',').map((entry) => entry.trim())) {
      if (!entry) continue
      const match = entry.match(
        /^(?:(.+):(\d+)(?:-(\d+))?->)?(\d+)(?:-(\d+))?\/(tcp|udp|sctp)$/
      )
      if (!match) throw new Error('Invalid Docker port mapping')
      const [, host, first, last, targetFirst, targetLast, protocol] = match
      const validRange = (start, end) =>
        Number(start) >= 1 &&
        Number(end || start) <= 65535 &&
        Number(end || start) >= Number(start)
      if (!validRange(targetFirst, targetLast)) {
        throw new Error('Invalid Docker container port range')
      }
      if (!host) continue // EXPOSE without publication does not occupy a host port.
      if (
        !isIP(host.replace(/^\[|\]$/g, '')) ||
        !validRange(first, last) ||
        Number(last || first) - Number(first) !==
          Number(targetLast || targetFirst) - Number(targetFirst)
      ) {
        throw new Error('Invalid Docker host port range')
      }
      if (protocol !== 'tcp') continue
      // Slipway's pool is global across interfaces, as are App.hostPort values.
      // Conservatively exclude published TCP numbers on every host interface.
      for (let port = Number(first); port <= Number(last || first); port++) {
        ports.add(port)
      }
    }
  }
  return [...ports]
}

module.exports._private = { parsePublishedPorts }
