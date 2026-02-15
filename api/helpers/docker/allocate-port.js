const net = require('net')

/**
 * Check if a port is actually available on the host
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port, '0.0.0.0')
  })
}

module.exports = {
  friendlyName: 'Allocate port',

  description: 'Allocate an available port from the Slipway port range.',

  inputs: {},

  exits: {
    success: {
      description: 'Port allocated',
      outputType: 'number'
    },
    noPortsAvailable: {
      description: 'No ports available in the configured range'
    }
  },

  fn: async function () {
    const portRange = sails.config.custom.slipwayPortRange

    // Get all ports already assigned in the database
    const apps = await App.find({
      hostPort: { '!=': null }
    }).select(['hostPort'])

    const usedPorts = new Set(apps.map((app) => Number(app.hostPort)))

    sails.log.debug(`Port allocator: ${usedPorts.size} ports in use: ${[...usedPorts].join(', ')}`)

    // Find first available port in range not already assigned in the database
    for (let port = portRange.start; port <= portRange.end; port++) {
      if (usedPorts.has(port)) {
        sails.log.debug(`Port ${port} assigned in DB, skipping`)
        continue
      }

      return port
    }

    sails.log.error('No ports available in configured range')
    throw 'noPortsAvailable'
  }
}
