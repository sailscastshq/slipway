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

    // Get ALL apps and filter in JS to avoid Waterline NULL query issues
    const allApps = await App.find().select(['hostPort'])
    const usedPorts = new Set()

    for (const app of allApps) {
      if (app.hostPort != null) {
        usedPorts.add(Number(app.hostPort))
      }
    }

    sails.log.debug(`Port allocator: ${usedPorts.size} ports in use: ${[...usedPorts].join(', ')}`)

    // Find first available port in range not already assigned
    for (let port = portRange.start; port <= portRange.end; port++) {
      if (usedPorts.has(port)) {
        continue
      }

      return port
    }

    sails.log.error('No ports available in configured range')
    throw 'noPortsAvailable'
  }
}
