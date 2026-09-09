module.exports = {
  attributes: {
    email: { type: 'string', unique: true, columnName: 'email_address' },
    account: { model: 'account', columnName: 'account_id' },
    manager: { model: 'user', columnName: 'manager_id' }
  }
}
