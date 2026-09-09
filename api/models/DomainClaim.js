module.exports = {
  tableName: 'domain_claims',
  attributes: {
    domain: { type: 'string', required: true, unique: true },
    owner: { type: 'string', required: true }
  }
}
