const net = require('node:net')

const DEFAULT_RESERVATION_TTL = 15 * 60 * 1000

module.exports = {
  friendlyName: 'Allocate port',

  description: 'Allocate an available port from the Slipway port range.',

  inputs: {
    host: {
      type: 'string',
      description:
        'Host interface the port will bind to. Defaults to the Slipway host bind address.'
    },
    ownerType: {
      type: 'string',
      description: 'Type of process reserving the port.'
    },
    ownerId: {
      type: 'string',
      description: 'ID of the process reserving the port.'
    },
    ttl: {
      type: 'number',
      defaultsTo: DEFAULT_RESERVATION_TTL,
      description:
        'How long the reservation can survive without being promoted or released.'
    },
    checkHost: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Whether to verify the port is available on the host.'
    }
  },

  exits: {
    success: {
      description: 'Port allocated',
      outputType: 'number'
    },
    noPortsAvailable: {
      description: 'No ports available in the configured range'
    }
  },

  fn: async function ({ host, ownerType, ownerId, ttl, checkHost }) {
    const portRange = sails.config.custom.slipwayPortRange
    const bindHost = normalizeHost(
      host || sails.config.custom.slipwayPortHost || '0.0.0.0'
    )

    await releaseExpiredReservations()

    // Get ALL apps and filter in JS to avoid Waterline NULL query issues
    const allApps = await App.find().select(['hostPort'])
    const usedPorts = new Set()

    for (const app of allApps) {
      if (app.hostPort != null) {
        usedPorts.add(Number(app.hostPort))
      }
    }

    const reservations = await PortReservation.find({ host: bindHost }).select([
      'port'
    ])
    for (const reservation of reservations) {
      usedPorts.add(Number(reservation.port))
    }

    sails.log.debug(
      `Port allocator (${bindHost}): ${
        usedPorts.size
      } ports in use or reserved: ${[...usedPorts].join(', ')}`
    )

    // Find first available port in range not already assigned or reserved.
    for (let port = portRange.start; port <= portRange.end; port++) {
      if (usedPorts.has(port)) {
        continue
      }

      if (checkHost && !(await isHostPortAvailable(bindHost, port))) {
        sails.log.debug(
          `Port allocator (${bindHost}): ${port} is already bound on host`
        )
        continue
      }

      const reserved = await reservePort({
        host: bindHost,
        port,
        ownerType,
        ownerId,
        ttl
      })
      if (reserved) {
        return port
      }

      usedPorts.add(port)
    }

    sails.log.error('No ports available in configured range')
    throw 'noPortsAvailable'
  }
}

async function releaseExpiredReservations() {
  await PortReservation.destroy({
    expiresAt: { '<': Date.now() }
  })
}

async function reservePort({ host, port, ownerType, ownerId, ttl }) {
  const key = reservationKey(host, port)

  try {
    await PortReservation.create({
      reservationKey: key,
      host,
      port,
      ownerType: ownerType || null,
      ownerId: ownerId || null,
      expiresAt: Date.now() + ttl
    })
    return true
  } catch (err) {
    if (isUniqueConflict(err)) {
      return false
    }

    throw err
  }
}

function isHostPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

function isUniqueConflict(err) {
  const code = err?.code || err?.raw?.code || err?.cause?.code

  return (
    code === 'E_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT' ||
    /unique|constraint/i.test(err?.message || '')
  )
}

function normalizeHost(host) {
  return String(host || '0.0.0.0').trim() || '0.0.0.0'
}

function reservationKey(host, port) {
  return `${normalizeHost(host)}:${port}`
}
