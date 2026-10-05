const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const ledger = require('../../api/lib/upgrade-ledger')
for (const version of ['0.0.86', '0.0.87']) {
  const baseline = require(`../fixtures/upgrades/${version}.json`)
  test(`genuine ${version} native catalogs replay with the captured physical fingerprint`, () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'release-baseline-')
    )
    try {
      assert.match(baseline.image, /@sha256:[a-f0-9]{64}$/)
      for (const [datastore, capture] of Object.entries(baseline.databases)) {
        assert.equal(capture.present, true)
        assert.equal(ledger.digest(capture.schema), capture.schemaHash)
        const filename = path.join(directory, `${datastore}.db`)
        const db = new Database(filename)
        try {
          for (const table of Object.values(capture.schema)) db.exec(table.sql)
          // SQLite reports the newest-created index first. Reverse the native
          // order when replaying so the complete physical inventory is exact.
          for (const table of Object.values(capture.schema)) {
            for (const index of [...table.indexes].reverse())
              if (index.sql) db.exec(index.sql)
            for (const trigger of table.triggers) db.exec(trigger.sql)
          }
          const views = new Map()
          for (const table of Object.values(capture.schema))
            for (const view of table.views) views.set(view.name, view.sql)
          for (const sql of views.values()) db.exec(sql)
          assert.equal(
            ledger.schemaHash({
              path: filename,
              transaction: { database: db }
            }),
            capture.schemaHash,
            datastore
          )
          assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
          assert.deepEqual(db.pragma('foreign_key_check'), [])
        } finally {
          db.close()
        }
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}
