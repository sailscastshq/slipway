module.exports = {
  tableName: 'custom_service_reviews',
  attributes: {
    token: { type: 'string', required: true, unique: true },
    actor: { type: 'number', required: true },
    environment: { type: 'number', required: true },
    definition: { type: 'json', encrypt: true, protect: true },
    imageReference: {
      type: 'string',
      required: true,
      columnName: 'image_reference'
    },
    imageMetadata: { type: 'json', columnName: 'image_metadata' },
    expiresAt: { type: 'number', required: true, columnName: 'expires_at' },
    serviceId: { type: 'number', allowNull: true, columnName: 'service_id' }
  }
}
