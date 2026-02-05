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

    // Get all currently used ports
    const apps = await App.find({
      hostPort: { '!=': null }
    }).select(['hostPort'])

    const usedPorts = new Set(apps.map((app) => app.hostPort))

    // Find first available port in range
    for (let port = portRange.start; port <= portRange.end; port++) {
      if (!usedPorts.has(port)) {
        return port
      }
    }

    sails.log.error('No ports available in configured range')
    throw 'noPortsAvailable'
  }
}
