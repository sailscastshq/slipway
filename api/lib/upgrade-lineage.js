const Database = require('better-sqlite3')
const ledger = require('./upgrade-ledger')
function fail() {
  throw Object.assign(
    new Error(
      'Prior upgrade receipts must be complete and bound to this instance.'
    ),
    { code: 'upgradeLedgerMismatch' }
  )
}
function verifyPrevious({ previous, services, instanceId, image }) {
  if (
    !previous ||
    previous.manifest?.instanceId !== instanceId ||
    previous.manifest.image === image
  )
    fail()
  const chain = []
  const seen = new Set()
  for (let item = previous; item; item = item.manifest.previous) {
    if (chain.length >= 32 || seen.has(item.hash)) fail()
    const verified = ledger.createManifest(item.manifest)
    if (
      verified.hash !== item.hash ||
      verified.manifest.instanceId !== instanceId
    )
      fail()
    const stores = new Set(
      verified.manifest.steps.map((step) => step.datastore)
    )
    if (
      stores.size !== 4 ||
      services.some((service) => !stores.has(service.datastore))
    )
      fail()
    seen.add(item.hash)
    chain.push(verified)
  }
  for (const service of services) {
    const current = ledger.inspectState(service, chain[0], service.databaseKey)
    if (!current.complete || current.pending.length) fail()
    const db = new Database(service.path, {
      readonly: true,
      fileMustExist: true
    })
    try {
      for (const item of chain) {
        const receipts = ledger.readLedger(
          db,
          item,
          service.datastore,
          service.databaseKey
        )
        if (
          receipts.length !==
          item.manifest.steps.filter(
            (step) => step.datastore === service.datastore
          ).length
        )
          fail()
      }
      if (
        db
          .prepare(`SELECT DISTINCT manifest_hash FROM ${ledger.table}`)
          .all()
          .some((row) => !seen.has(row.manifest_hash))
      )
        fail()
    } finally {
      db.close()
    }
  }
  return chain[0]
}
module.exports = verifyPrevious
