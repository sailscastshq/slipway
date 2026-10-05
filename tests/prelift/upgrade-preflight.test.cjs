const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const runPreflight = require('../../api/lib/upgrade-preflight')
const { verifyBackupSet } = require('../../api/lib/upgrade-backups')
const ledger = require('../../api/lib/upgrade-ledger')
const { fixture, preparePlan } = require('./upgrade-fixtures.cjs')

test('clone preflight uses the shared executor and leaves live databases and recovery snapshots unchanged', () =>
  fixture(async ({ identity, backupSet, databases }) => {
    const originals = databases.map((item) => fs.readFileSync(item.path))
    const before = await verifyBackupSet(backupSet, 10000)
    const result = await runPreflight({
      backupSet,
      identity,
      preparePlan: async (input) => {
        assert.equal(global.sails, undefined)
        assert.ok(
          input.service.path.startsWith(
            backupSet.directory + path.sep + 'preflight-'
          )
        )
        return preparePlan(input)
      },
      timeoutMs: 10000
    })
    assert.equal(result.dryRun, true)
    assert.deepEqual(result.steps, [
      { stepId: 'default', outcome: 'verifiedOnClone' },
      { stepId: 'observability', outcome: 'verifiedOnClone' }
    ])
    assert.deepEqual(await verifyBackupSet(backupSet, 10000), before)
    assert.equal(
      fs
        .readdirSync(backupSet.directory)
        .some((item) => item.startsWith('preflight-')),
      false
    )
    databases.forEach((item, index) =>
      assert.deepEqual(fs.readFileSync(item.path), originals[index])
    )
  }))
test('a later database manifest mismatch fails preflight without live receipts or DDL', () =>
  fixture(async ({ identity, backupSet, databases }) => {
    const modified = JSON.parse(JSON.stringify(identity.manifest))
    modified.steps[1].toSchemaHash = 'f'.repeat(64)
    const originals = databases.map((item) => fs.readFileSync(item.path))
    await assert.rejects(
      () =>
        runPreflight({
          backupSet,
          identity: ledger.createManifest(modified),
          preparePlan,
          timeoutMs: 10000
        }),
      /immutable manifest/
    )
    databases.forEach((item, index) =>
      assert.deepEqual(fs.readFileSync(item.path), originals[index])
    )
    assert.equal(
      fs
        .readdirSync(backupSet.directory)
        .some((item) => item.startsWith('preflight-')),
      false
    )
    await verifyBackupSet(backupSet, 10000)
  }))
test('a plan for a different pinned source cannot execute even on the clone', () =>
  fixture(async ({ identity, backupSet }) => {
    await assert.rejects(
      () =>
        runPreflight({
          backupSet,
          identity,
          preparePlan: async (input) => {
            const result = await preparePlan(input)
            result.entry.payload.sourceHash = 'another-source'
            return result
          },
          timeoutMs: 10000
        }),
      /pinned source and target/
    )
    await verifyBackupSet(backupSet, 10000)
  }))

test('a stalled plan registry hits the deadline and removes its disposable clones', () =>
  fixture(async ({ identity, backupSet }) => {
    await assert.rejects(
      () =>
        runPreflight({
          backupSet,
          identity,
          preparePlan: () => new Promise(() => {}),
          timeoutMs: 100
        }),
      /deadline/
    )
    assert.equal(
      fs
        .readdirSync(backupSet.directory)
        .some((item) => item.startsWith('preflight-')),
      false
    )
    await verifyBackupSet(backupSet, 10000)
  }))
