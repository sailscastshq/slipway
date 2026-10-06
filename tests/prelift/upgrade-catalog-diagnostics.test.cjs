const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Database = require('better-sqlite3')
const diagnostics = require('./fixtures/upgrade-catalog-diagnostics.cjs')
const { fixture, profiles, image } = require('./release-fixtures.cjs')
const registry = require('../../api/lib/upgrade-registry')
test('bounded fixture diagnostics preserve catalog hashes while redacting SQL, rows, unknown names and paths', () =>
  fixture(profiles.old, async ({ services }) => {
    const reviewed = registry.createReleasePlan({
      services,
      image,
      instanceId: 'fixture-instance'
    })
    const input = { services, steps: reviewed.manifest.steps }
    const before = await diagnostics.bounded(input)
    assert.equal(before.status, 'captured')
    assert.equal(before.reports.length, 4)
    assert.ok(before.reports.every((report) => report.matchesReviewed))
    const db = new Database(services[0].path)
    db.exec(
      "ALTER TABLE apps ADD COLUMN private_fixture_column TEXT DEFAULT 'never-print-this-default'; CREATE TABLE private_fixture_name(value TEXT); INSERT INTO private_fixture_name VALUES('never-print-this-row')"
    )
    db.close()
    const result = await diagnostics.bounded(input)
    const report = result.reports.find((item) => item.datastore === 'default')
    assert.equal(report.matchesReviewed, false)
    assert.equal(report.unknownTables, 1)
    assert.ok(
      report.mismatches.some(
        (item) => item.table === 'apps' && item.changed.includes('columns')
      )
    )
    const output = JSON.stringify(result)
    for (const forbidden of [
      'private_fixture_column',
      'private_fixture_name',
      'never-print-this-default',
      'never-print-this-row',
      services[0].path,
      'CREATE TABLE',
      'ALTER TABLE'
    ])
      assert.ok(!output.includes(forbidden))
    assert.ok(Buffer.byteLength(output) < 16384)
    assert.throws(
      () =>
        registry.createReleasePlan({
          services,
          image,
          instanceId: 'fixture-instance'
        }),
      { code: 'upgradeUnsupportedSchema' }
    )
  }))
test('unreadable native catalog diagnostics retain only SQLite code without exception text or input paths', () =>
  fixture(profiles.old, async ({ services }) => {
    fs.writeFileSync(services[0].path, 'synthetic-corrupt-no-secret')
    const result = await diagnostics.bounded({ services, steps: [] })
    const report = result.reports.find((item) => item.datastore === 'default')
    assert.equal(report.status, 'unreadable')
    assert.equal(report.sqliteCode, 'SQLITE_NOTADB')
    const output = JSON.stringify(result)
    assert.ok(!output.includes(services[0].path))
    assert.ok(!output.includes('not a database'))
    assert.ok(!output.includes('synthetic-corrupt-no-secret'))
  }))
