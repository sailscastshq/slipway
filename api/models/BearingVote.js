/**
 * BearingVote.js
 *
 * One app-scoped vote. The opaque voter key prevents duplicate identified or
 * anonymous votes without storing a raw browser visitor identifier.
 */

module.exports = {
  tableName: 'bearing_votes',

  attributes: {
    voterKey: {
      type: 'string',
      required: true,
      unique: true,
      protect: true,
      maxLength: 64,
      columnName: 'voter_key'
    },

    participant: {
      model: 'bearingparticipant'
    },

    feedback: {
      model: 'bearingfeedback',
      required: true
    },

    space: {
      model: 'bearingspace',
      required: true
    }
  }
}
