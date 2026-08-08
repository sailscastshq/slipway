const crypto = require('node:crypto')

/**
 * BearingUpdate.js
 *
 * A short product update authored by a Slipway operator and published to one
 * app-owned Bearing space.
 */

module.exports = {
  tableName: 'bearing_updates',

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

    slug: {
      type: 'string',
      required: true,
      maxLength: 180,
      regex: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    },

    excerpt: {
      type: 'string',
      required: true,
      maxLength: 280
    },

    body: {
      type: 'string',
      required: true,
      maxLength: 10000
    },

    status: {
      type: 'string',
      isIn: ['draft', 'published'],
      defaultsTo: 'draft'
    },

    publishedAt: {
      type: 'number',
      allowNull: true,
      columnName: 'published_at'
    },

    author: {
      model: 'user',
      required: true
    },

    space: {
      model: 'bearingspace',
      required: true
    },

    app: {
      model: 'app',
      required: true
    },

    links: {
      collection: 'bearingupdatelink',
      via: 'update'
    }
  },

  beforeCreate: async function (values, proceed) {
    if (!values.publicId) {
      values.publicId = `bup_${crypto.randomBytes(10).toString('base64url')}`
    }
    values.title = normalizeRequired(values.title, 140)
    values.slug = normalizeRequired(values.slug, 180)
    values.excerpt = normalizeRequired(values.excerpt, 280)
    values.body = normalizeRequired(values.body, 10000)
    return proceed()
  },

  beforeUpdate: async function (values, proceed) {
    if (values.title !== undefined) {
      values.title = normalizeRequired(values.title, 140)
    }
    if (values.slug !== undefined) {
      values.slug = normalizeRequired(values.slug, 180)
    }
    if (values.excerpt !== undefined) {
      values.excerpt = normalizeRequired(values.excerpt, 280)
    }
    if (values.body !== undefined) {
      values.body = normalizeRequired(values.body, 10000)
    }
    return proceed()
  }
}

function normalizeRequired(value, maxLength) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
}
