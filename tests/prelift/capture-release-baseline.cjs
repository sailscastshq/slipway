// Runs inside a stopped release's disposable fixture volume. Only native schema
// and row counts leave the container; never rows, environment or credentials.
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const readSchema = require('../../api/lib/sqlite-schema')
const { digest } = require('../../api/lib/upgrade-ledger')
const [directory, version, image] = process.argv.slice(2)
if (
  !directory ||
  !/^0\.0\.(86|87)$/.test(version || '') ||
  !/^.+@sha256:[a-f0-9]{64}$/.test(image || '')
)
  throw new Error('Baseline capture requires an exact supported release image.')
const databases = {}
for (const [datastore, file] of Object.entries({
  default: 'app.db',
  observability: 'observability.db',
  analytics: 'analytics.db',
  cache: 'stash.db'
})) {
  const filename = path.join(directory, file)
  if (!fs.existsSync(filename)) {
    databases[datastore] = { present: false }
    continue
  }
  const db = new Database(filename, { readonly: true, fileMustExist: true })
  try {
    if (
      db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      db.pragma('foreign_key_check').length
    )
      throw new Error(`Baseline database failed integrity checks: ${datastore}`)
    const schema = readSchema({ path: filename, transaction: { database: db } })
    if (
      schema.error ||
      Object.values(schema.tables).some((table) => !table.catalogComplete)
    )
      throw new Error(`Baseline has unsupported native schema: ${datastore}`)
    const rowCounts = {}
    for (const name of Object.keys(schema.tables).sort())
      rowCounts[name] = db
        .prepare(`SELECT COUNT(*) AS count FROM "${name.replace(/"/g, '""')}"`)
        .get().count
    databases[datastore] = {
      present: true,
      schema: schema.tables,
      schemaHash: digest(schema.tables),
      rowCounts
    }
  } finally {
    db.close()
  }
}
if (!databases.default.present || !databases.observability.present)
  throw new Error('Release baseline is missing an owned database.')
process.stdout.write(
  JSON.stringify({ format: 1, version, image, databases }, null, 2) + '\n'
)
