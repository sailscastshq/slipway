/**
 * CliToken.js
 *
 * @description :: A model for storing CLI authentication tokens.
 *                 Persists tokens so they survive server restarts.
 */

module.exports = {
  tableName: 'cli_tokens',
  attributes: {
    token: {
      type: 'string',
      required: true,
      unique: true,
      description: 'The authentication token (hashed)'
    },
    user: {
      model: 'user',
      required: true,
      description: 'The user this token belongs to'
    },
    name: {
      type: 'string',
      defaultsTo: 'CLI',
      description: 'A friendly name for this token (e.g., "MacBook Pro")'
    },
    lastUsedAt: {
      type: 'ref',
      columnType: 'datetime',
      description: 'When this token was last used',
      columnName: 'last_used_at'
    },
    expiresAt: {
      type: 'ref',
      columnType: 'datetime',
      description: 'When this token expires (null = never)',
      columnName: 'expires_at'
    }
  }
}
