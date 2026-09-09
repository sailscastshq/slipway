module.exports = {
  tableName: 'bridge_support_events',
  attributes: {
    eventId: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'event_id'
    },
    grant: { model: 'bridgesupportgrant', required: true },
    action: { type: 'string', required: true }
  }
}
