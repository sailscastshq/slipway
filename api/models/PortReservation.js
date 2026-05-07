/**
 * PortReservation.js
 *
 * Short-lived host port reservations for deployment and update flows.
 */

module.exports = {
  tableName: 'port_reservations',

  attributes: {
    reservationKey: {
      type: 'string',
      required: true,
      unique: true,
      description: 'Unique host:port reservation key.',
      columnName: 'reservation_key'
    },

    host: {
      type: 'string',
      required: true,
      description: 'Host interface the port is reserved on.'
    },

    port: {
      type: 'number',
      required: true,
      description: 'Reserved host port.'
    },

    ownerType: {
      type: 'string',
      allowNull: true,
      description: 'Type of process that owns the reservation.',
      columnName: 'owner_type'
    },

    ownerId: {
      type: 'string',
      allowNull: true,
      description: 'ID of the process that owns the reservation.',
      columnName: 'owner_id'
    },

    expiresAt: {
      type: 'number',
      allowNull: true,
      description: 'Timestamp after which the reservation can be recycled.',
      columnName: 'expires_at'
    }
  }
}
