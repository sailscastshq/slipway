const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Database = require('better-sqlite3')
const registry = require('../../api/lib/upgrade-registry')
const ledger = require('../../api/lib/upgrade-ledger')
const { fixture, complete } = require('./release-fixtures.cjs')
const image = `ghcr.io/sailscastshq/slipway@sha256:${'b'.repeat(64)}`
for (const mode of [
  'partial',
  'wrong-instance',
  'tampered',
  'unknown-manifest',
  'same-image'
])
  test(`prior ledger ${mode} blocks transition read-only`, () =>
    fixture(null, async (state) => {
      const previous = JSON.parse(
        JSON.stringify(await complete(state, 'fresh'))
      )
      const db = new Database(state.services.at(-1).path)
      if (mode === 'partial') db.prepare(`DELETE FROM ${ledger.table}`).run()
      if (mode === 'unknown-manifest')
        db.prepare(`INSERT INTO ${ledger.table} VALUES(?,?,?,?)`).run(
          'c'.repeat(64),
          'unknown',
          '{}',
          'd'.repeat(64)
        )
      db.close()
      if (mode === 'tampered') previous.hash = 'e'.repeat(64)
      if (mode === 'wrong-instance')
        previous.manifest.instanceId = 'another-instance'
      const before = state.services.map((service) =>
        fs.readFileSync(service.path)
      )
      assert.throws(
        () =>
          registry.createReleasePlan({
            services: state.services,
            instanceId: 'fixture-instance',
            image: mode === 'same-image' ? previous.manifest.image : image,
            previous
          }),
        { code: 'upgradeLedgerMismatch' }
      )
      state.services.forEach((service, index) =>
        assert.deepEqual(fs.readFileSync(service.path), before[index])
      )
    }))
