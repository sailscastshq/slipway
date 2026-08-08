/**
 * BearingUpdateLink.js
 *
 * Explicit join between one published update and the feedback it delivered.
 */

module.exports = {
  tableName: 'bearing_update_links',

  attributes: {
    linkKey: {
      type: 'string',
      unique: true,
      protect: true,
      maxLength: 64,
      columnName: 'link_key'
    },

    update: {
      model: 'bearingupdate',
      required: true,
      columnName: 'bearing_update'
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
