/**
 * CliToken.js
 *
 * @description :: A model for storing CLI authentication tokens.
 *                 Persists tokens so they survive server restarts.
 */

module.exports = {
  tableName: 'cli_tokens',
  attributes: {
    team: { model: 'team', columnName: 'team_id' },
    authVersion: {
      type: 'string',
      defaultsTo: '',
      columnName: 'auth_version',
      protect: true
    },
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
  },
  beforeCreate: async function (values, proceed) {
    const user = await User.findOne({ id: values.user })
    if (!user) return proceed(new Error('Token user no longer exists'))
    values.authVersion = user.authVersion || ''
    if (!values.team) values.team = user.team
    return proceed()
  }
}
