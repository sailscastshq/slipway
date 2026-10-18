module.exports = {
  tableName: 'bearing_update_deliveries',
  attributes: {
    deliveryKey: {
      type: 'string',
      unique: true,
      required: true,
      columnName: 'delivery_key'
    },
    publication: {
      model: 'bearingupdatepublication',
      required: true
    },
    consent: {
      model: 'bearingupdateconsent',
      required: true
    },
    participant: {
      model: 'bearingparticipant',
      required: true
    },
    state: {
      type: 'string',
      defaultsTo: 'pending'
    },
    attempts: {
      type: 'number',
      defaultsTo: 0
    },
    nextAttemptAt: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'next_attempt_at'
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
