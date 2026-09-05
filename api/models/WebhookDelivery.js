module.exports = {
  tableName: 'webhook_deliveries',
  attributes: {
    key: { type: 'string', required: true, unique: true },
    status: {
      type: 'string',
      isIn: ['processing', 'completed'],
      defaultsTo: 'processing'
    },
    result: { type: 'json' }
  }
}
