module.exports = {
  tableName: 'team_memberships',
  attributes: {
    key: { type: 'string', required: true, unique: true },
    user: { model: 'user', required: true, columnName: 'user_id' },
    team: { model: 'team', required: true, columnName: 'team_id' },
    role: {
      type: 'string',
      isIn: ['owner', 'admin', 'member'],
      defaultsTo: 'member'
    },
    status: {
      type: 'string',
      isIn: ['active', 'invited'],
      defaultsTo: 'active'
    }
  }
}
