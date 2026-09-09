module.exports = {
  tableName: 'bridge_support_grants',
  attributes: {
    tokenHash: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'token_hash',
      protect: true
    },
    credentialHash: {
      type: 'string',
      required: true,
      columnName: 'credential_hash',
      protect: true
    },
    app: { model: 'app', required: true },
    actor: { model: 'user', required: true },
    scope: { type: 'json', required: true },
    expiresAt: { type: 'number', required: true, columnName: 'expires_at' },
    consumedAt: { type: 'number', allowNull: true, columnName: 'consumed_at' },
    endsAt: { type: 'number', required: true, columnName: 'ends_at' },
    status: {
      type: 'string',
      isIn: ['issued', 'active', 'denied', 'stopped', 'expired', 'revoked'],
      defaultsTo: 'issued'
    }
  }
}
