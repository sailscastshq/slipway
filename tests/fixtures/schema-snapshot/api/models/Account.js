module.exports = {
  primaryKey: 'key',
  attributes: {
    id: false,
    key: {
      type: 'string',
      columnType: 'varchar(80)',
      columnName: 'account_key'
    },
    members: { collection: 'user', via: 'account' }
  }
}
