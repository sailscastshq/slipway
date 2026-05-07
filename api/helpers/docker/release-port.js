module.exports = {
  friendlyName: 'Release port',

  description: 'Release a Slipway host port reservation.',

  inputs: {
    hostPort: {
      type: 'number',
      required: true,
      description: 'Host port to release.'
    },
    host: {
      type: 'string',
      description:
        'Host interface the port was reserved on. Defaults to the Slipway host bind address.'
    },
    ownerType: {
      type: 'string',
      description: 'Type of process that reserved the port.'
    },
    ownerId: {
      type: 'string',
      description: 'ID of the process that reserved the port.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ hostPort, host, ownerType, ownerId }) {
    const bindHost = normalizeHost(
      host || sails.config.custom.slipwayPortHost || '0.0.0.0'
    )
    const criteria = {
      reservationKey: `${bindHost}:${hostPort}`
    }

    if (ownerType) {
      criteria.ownerType = ownerType
    }

    if (ownerId) {
      criteria.ownerId = ownerId
    }

    const released = await PortReservation.destroy(criteria).fetch()

    return {
      released: released.length
    }
  }
}

function normalizeHost(host) {
  return String(host || '0.0.0.0').trim() || '0.0.0.0'
}
