module.exports = {
  tableName: 'bearing_update_consents',
  attributes: {
    participant: {
      model: 'bearingparticipant',
      required: true
    },
    space: {
      model: 'bearingspace',
      required: true
    },
    state: {
      type: 'string',
      isIn: ['on', 'off'],
      defaultsTo: 'off'
    },
    emailHash: {
      type: 'string',
      allowNull: true,
      protect: true,
      columnName: 'email_hash'
    }
  }
}
