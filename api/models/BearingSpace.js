const crypto = require('node:crypto')
const { DEFAULT_BEARING_CATEGORIES } = require('../lib/bearing-categories')

/**
 * BearingSpace.js
 *
 * App-scoped configuration for Bearing's public feedback loop. Customer
 * participants remain separate from Slipway users and Bridge access grants.
 */

module.exports = {
  tableName: 'bearing_spaces',

  attributes: {
    publicSlug: {
      type: 'string',
      required: true,
      unique: true,
      maxLength: 80,
      columnName: 'public_slug'
    },

    acceptFeedback: {
      type: 'boolean',
      defaultsTo: true,
      columnName: 'accept_feedback'
    },

    allowAnonymousParticipation: {
      type: 'boolean',
      defaultsTo: false,
      columnName: 'allow_anonymous_participation'
    },

    feedbackCategories: {
      type: 'json',
      defaultsTo: DEFAULT_BEARING_CATEGORIES,
      columnName: 'feedback_categories'
    },

    showPublicRoadmap: {
      type: 'boolean',
      defaultsTo: true,
      columnName: 'show_public_roadmap'
    },

    showPublicUpdates: {
      type: 'boolean',
      defaultsTo: true,
      columnName: 'show_public_updates'
    },

    widgetEnabled: {
      type: 'boolean',
      defaultsTo: false,
      columnName: 'widget_enabled'
    },

    widgetSide: {
      type: 'string',
      isIn: ['left', 'right'],
      defaultsTo: 'right',
      columnName: 'widget_side'
    },

    widgetOpeningView: {
      type: 'string',
      isIn: ['feedback', 'updates'],
      defaultsTo: 'updates',
      columnName: 'widget_opening_view'
    },

    showUnread: {
      type: 'boolean',
      defaultsTo: true,
      columnName: 'show_unread'
    },

    app: {
      model: 'app',
      required: true,
      unique: true
    },

    createdBy: {
      model: 'user',
      required: true,
      columnName: 'created_by'
    },

    participants: {
      collection: 'bearingparticipant',
      via: 'space'
    },

    feedback: {
      collection: 'bearingfeedback',
      via: 'space'
    },

    updates: {
      collection: 'bearingupdate',
      via: 'space'
    }
  },

  beforeCreate: async function (values, proceed) {
    if (!values.publicSlug) {
      values.publicSlug = crypto.randomBytes(18).toString('base64url')
    }
    return proceed()
  }
}
