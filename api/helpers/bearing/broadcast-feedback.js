const {
  BEARING_FEEDBACK_EVENT,
  roomName
} = require('../../lib/bearing-realtime')

module.exports = {
  friendlyName: 'Broadcast Bearing feedback',

  description:
    'Publish one public-safe feedback change to subscribers of its Bearing space.',

  inputs: {
    spaceId: { type: 'string', required: true },
    verb: {
      type: 'string',
      isIn: ['created', 'updated', 'removed'],
      required: true
    },
    feedback: { type: 'ref', required: true }
  },

  fn: async function ({ spaceId, verb, feedback }) {
    if (!sails.sockets) return

    sails.sockets.broadcast(roomName(spaceId), BEARING_FEEDBACK_EVENT, {
      verb,
      feedback
    })
  }
}
