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

    const usedPorts = new Set(apps.map((app) => app.hostPort))

    // Find first available port in range (check both DB and actual availability)
    for (let port = portRange.start; port <= portRange.end; port++) {
      if (usedPorts.has(port)) continue

      // Check if port is actually available on the host
      const available = await isPortAvailable(port)
      if (available) {
        return port
      }

      sails.log.verbose(`Port ${port} is in use by another process, skipping`)
    }

    sails.log.error('No ports available in configured range')
    throw 'noPortsAvailable'
  }
}
