const { BEARING_UPDATE_EVENT, roomName } = require('../../lib/bearing-realtime')

module.exports = {
  friendlyName: 'Broadcast Bearing update',

  description: 'Publish one public-safe product update to its Bearing space.',

  inputs: {
    spaceId: { type: 'string', required: true },
    verb: {
      type: 'string',
      isIn: ['published', 'updated', 'removed'],
      required: true
    },
    update: { type: 'ref', required: true }
  },

  fn: async function ({ spaceId, verb, update }) {
    if (!sails.sockets) return
    sails.sockets.broadcast(roomName(spaceId), BEARING_UPDATE_EVENT, {
      verb,
      update
    })
  }
}
