module.exports = {
  tableName: 'bearing_update_publications',
  attributes: {
    publicationKey: {
      type: 'string',
      unique: true,
      required: true,
      columnName: 'publication_key'
    },
    bearingUpdate: {
      model: 'bearingupdate',
      required: true,
      columnName: 'bearing_update'
    },
    space: {
      model: 'bearingspace',
      required: true
    },
    snapshot: {
      type: 'json',
      required: true
    },
    consentWatermark: {
      type: 'number',
      required: true,
      columnName: 'consent_watermark'
    },
    cursor: {
      type: 'number',
      defaultsTo: 0
    },
    state: {
      type: 'string',
      defaultsTo: 'pending'
    },
    leaseToken: {
      type: 'string',
      allowNull: true,
      protect: true,
      columnName: 'lease_token'
    },
    leaseUntil: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'lease_until'
    }
  }
}
