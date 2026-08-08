const crypto = require('node:crypto')

/**
 * BearingFeedback.js
 *
 * One piece of app-owned customer feedback. Identity is optional only when the
 * Bearing space explicitly allows anonymous participation.
 */

module.exports = {
  tableName: 'bearing_feedback',

  attributes: {
    publicId: {
      type: 'string',
      unique: true,
      maxLength: 40,
      columnName: 'public_id'
    },

    title: {
      type: 'string',
      required: true,
      maxLength: 140
    },

    details: {
      type: 'string',
      allowNull: true,
      maxLength: 5000
    },

    images: {
      type: 'json',
      defaultsTo: []
    },

    category: {
      type: 'string',
      maxLength: 40,
      defaultsTo: 'feature'
    },

    status: {
      type: 'string',
      isIn: ['reviewing', 'planned', 'in_progress', 'shipped', 'closed'],
      defaultsTo: 'reviewing'
    },

    voteCount: {
      type: 'number',
      defaultsTo: 0,
      min: 0,
      columnName: 'vote_count'
    },

    submittedAnonymously: {
      type: 'boolean',
      defaultsTo: false,
      columnName: 'submitted_anonymously'
    },

    author: {
      model: 'bearingparticipant'
    },

    space: {
      model: 'bearingspace',
      required: true
    },

    app: {
      model: 'app',
      required: true
    },

    votes: {
      collection: 'bearingvote',
      via: 'feedback'
    },

    updateLinks: {
      collection: 'bearingupdatelink',
      via: 'feedback'
    }
  },

  beforeCreate: async function (values, proceed) {
    if (!values.publicId) {
      values.publicId = `bfd_${crypto.randomBytes(10).toString('base64url')}`
    }
    values.title = String(values.title || '').trim()
    values.details = normalizeDetails(values.details)
    return proceed()
  }
}

function normalizeDetails(value) {
  const details = String(value || '').trim()
  return details ? details.slice(0, 5000) : null
}
