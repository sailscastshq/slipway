const transaction = require('./with-datastore-transaction')

async function reserve(domains, owner, db) {
  if (!db)
    return transaction((connection) => reserve(domains, owner, connection))
  for (const value of domains) {
    const domain = value.toLowerCase()
    const existing = await DomainClaim.findOne({ domain }).usingConnection(db)
    if (existing && existing.owner !== owner) {
      const error = new Error(
        'This domain is already assigned to another resource.'
      )
      error.code = 'DOMAIN_IN_USE'
      throw error
    }
    if (!existing)
      await DomainClaim.create({ domain, owner }).usingConnection(db)
  }
}
async function release(owner, keep = []) {
  await DomainClaim.destroy({
    owner,
    ...(keep.length
      ? { domain: { nin: keep.map((domain) => domain.toLowerCase()) } }
      : {})
  })
}
module.exports = { reserve, release }
