const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')
const {
  coordinatorFixture: runFixture,
  preparePlan
} = require('./upgrade-fixtures.cjs')
const coordinator = require('../../api/lib/upgrade-coordinator')
const preflight = require('../../api/lib/upgrade-preflight')
const executeStep = require('../../api/lib/upgrade-execution')
const ledger = require('../../api/lib/upgrade-ledger')
const { verifyBackupSet } = require('../../api/lib/upgrade-backups')
function inspect(filename) {
  const db = new Database(filename, { readonly: true })
  try {
    return {
      columns: db.pragma('table_info(notes)').map((row) => row.name),
      rows: db.prepare('SELECT id, title FROM notes').all()
    }
  } finally {
    db.close()
  }
}
test('the cross-database coordinator reaches a durable complete release through the shared executor', () =>
  runFixture(async ({ options, databases, handle, backupSet }) => {
    const result = await coordinator.run(options)
    assert.equal(result.phase, 'completed')
    assert.deepEqual(result.applied, ['default', 'observability'])
    assert.deepEqual(result.pending, [])
    assert.equal(result.reconciled, true)
    assert.equal(fs.statSync(handle.filename).mode & 0o777, 0o600)
    for (const target of databases) {
      assert.ok(inspect(target.path).columns.includes('note'))
      assert.deepEqual(inspect(target.path).rows, [
        { id: 1, title: 'protected' }
      ])
    }
    await verifyBackupSet(backupSet, 10000)
  }))
test('an interruption between databases resumes only the pending step without rollback of committed data', () =>
  runFixture(async ({ options, databases }) => {
    await assert.rejects(
      () =>
        coordinator.run({
          ...options,
          afterCheckpoint: async ({ stepId }) => {
            if (stepId === 'default')
              throw new Error('between database interruption')
          }
        }),
      /interruption/
    )
    assert.deepEqual(coordinator.status(options.filename).applied, ['default'])
    assert.ok(inspect(databases[0].path).columns.includes('note'))
    assert.equal(inspect(databases[1].path).columns.includes('note'), false)
    const called = []
    const resumed = await coordinator.run({
      ...options,
      owner: 'resumed-controller',
      preparePlan: async (input) => {
        called.push(input.step.id)
        return preparePlan(input)
      }
    })
    assert.deepEqual(called, ['observability'])
    assert.equal(resumed.phase, 'completed')
  }))
test('committed-but-audit-incomplete results retain receipts and safely reconcile on resume', () =>
  runFixture(async ({ options }) => {
    await assert.rejects(
      () =>
        coordinator.run({
          ...options,
          audit: async (_, action) => {
            if (action === 'migration.applied')
              throw new Error('audit unavailable')
          }
        }),
      /reconciliation/
    )
    assert.deepEqual(coordinator.status(options.filename).applied, ['default'])
    const called = []
    await coordinator.run({
      ...options,
      preparePlan: async (input) => {
        called.push(input.step.id)
        return preparePlan(input)
      }
    })
    assert.deepEqual(called, ['observability'])
  }))
test('SIGKILL after a database commit reconciles the lagging journal only after proving the old controller stopped', () =>
  runFixture(async ({ options, identity, backupSet, databases }) => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `
    const fs = require('node:fs')
    const input = JSON.parse(fs.readFileSync(0, 'utf8'))
    const coordinator = require(input.coordinatorPath)
    const { preparePlan } = require(input.fixturePath)
    coordinator.run({ ...input.options, owner: 'killed-controller', preparePlan,
      verifyFence: async (targets, { owner }) => ({ id: input.fenceId, writersStopped: true, exclusiveController: true, controllerOwner: owner, databaseKeys: targets.map(item => item.databaseKey) }),
      audit: async (_, action) => { if (action === 'migration.applied') process.kill(process.pid, 'SIGKILL') }
    }).catch(error => { console.error(error.message); process.exit(1) })
  `
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        input: JSON.stringify({
          options: {
            filename: options.filename,
            timeoutMs: options.timeoutMs,
            expectedInstanceId: options.expectedInstanceId,
            expectedManifestHash: options.expectedManifestHash
          },
          fenceId: backupSet.receipt.fenceId,
          coordinatorPath: require.resolve('../../api/lib/upgrade-coordinator'),
          fixturePath: require.resolve('./upgrade-fixtures.cjs')
        }),
        encoding: 'utf8'
      }
    )
    assert.equal(child.signal, 'SIGKILL', child.stderr)
    const checkpoint = coordinator.status(options.filename)
    assert.equal(checkpoint.reconciled, false)
    assert.deepEqual(checkpoint.applied, ['default'])
    assert.equal(inspect(databases[1].path).columns.includes('note'), false)
    await assert.rejects(
      () => coordinator.run(options),
      /exclusive upgrade controller/
    )
    assert.ok(fs.existsSync(options.filename + '.lock'))
    const result = await coordinator.run({
      ...options,
      owner: 'proved-replacement-controller',
      verifyFence: async (targets, { owner, previousOwner }) => ({
        id: backupSet.receipt.fenceId,
        writersStopped: true,
        exclusiveController: true,
        controllerOwner: owner,
        databaseKeys: targets.map((item) => item.databaseKey),
        previousOwnerStopped: previousOwner === 'killed-controller'
      })
    })
    assert.equal(result.phase, 'completed')
    assert.equal(result.manifestHash, identity.hash)
    assert.equal(fs.existsSync(options.filename + '.lock'), false)
  }))
test('lease age and the same owner name never authorize taking over an existing controller lock', () =>
  runFixture(async ({ options, handle, databases }) => {
    const originals = databases.map((item) => fs.readFileSync(item.path))
    const lock = options.filename + '.lock'
    fs.writeFileSync(
      lock,
      JSON.stringify({ owner: 'another-active-controller', runId: handle.id }),
      { mode: 0o600 }
    )
    fs.utimesSync(lock, new Date(0), new Date(0))
    await assert.rejects(
      () => coordinator.run(options),
      /exclusive upgrade controller/
    )
    await assert.rejects(
      () => coordinator.run({ ...options, owner: 'another-active-controller' }),
      /already owned/
    )
    databases.forEach((item, index) =>
      assert.deepEqual(fs.readFileSync(item.path), originals[index])
    )
  }))
test('a lost writer fence inside the schema transaction rolls back schema and receipt', () =>
  runFixture(async ({ options, backupSet, databases }) => {
    let calls = 0
    await assert.rejects(
      () =>
        coordinator.run({
          ...options,
          verifyFence: async (targets, { owner }) => ({
            id: backupSet.receipt.fenceId,
            writersStopped: ++calls < 3,
            exclusiveController: true,
            controllerOwner: owner,
            databaseKeys: targets.map((item) => item.databaseKey)
          })
        }),
      /reconciliation/
    )
    assert.deepEqual(coordinator.status(options.filename).applied, [])
    databases.forEach((item) =>
      assert.equal(inspect(item.path).columns.includes('note'), false)
    )
  }))
test('replacement files and different instance or manifest requests fail before DDL', () =>
  runFixture(async ({ options, databases }) => {
    await assert.rejects(
      () =>
        coordinator.run({ ...options, expectedInstanceId: 'wrong-instance' }),
      /requested instance/
    )
    await assert.rejects(
      () =>
        coordinator.run({ ...options, expectedManifestHash: 'wrong-manifest' }),
      /requested instance/
    )
    const filename = databases[0].path
    const replacement = filename + '.replacement'
    fs.copyFileSync(filename, replacement)
    fs.renameSync(replacement, filename)
    await assert.rejects(() => coordinator.run(options), /replaced or moved/)
    assert.equal(inspect(filename).columns.includes('note'), false)
  }))
test('out-of-order database receipts and journals claiming missing commits fail closed', () =>
  runFixture(async ({ options, identity, backupSet, databases }) => {
    const step = identity.manifest.steps[1]
    const service = { ...databases[1], type: 'sqlite' }
    const source = {
      version: identity.manifest.version,
      image: identity.manifest.image
    }
    const prepared = await preparePlan({ step, service, source })
    assert.equal(
      (
        await executeStep({
          prepared,
          identity,
          step,
          service,
          databaseKey: service.databaseKey,
          backupId: backupSet.id,
          fenceId: backupSet.receipt.fenceId
        })
      ).success,
      true
    )
    assert.throws(() => coordinator.status(options.filename), /global prefix/)
    await assert.rejects(() => coordinator.run(options), /global prefix/)
  }))
test('a corrupt journal, missing recovery backup or stalled registry cannot produce further DDL', () =>
  runFixture(async ({ options, backupSet, databases }) => {
    const original = fs.readFileSync(options.filename)
    const envelope = JSON.parse(original)
    envelope.state.applied = ['default']
    envelope.checksum = ledger.digest(envelope.state)
    fs.writeFileSync(options.filename, JSON.stringify(envelope))
    assert.throws(
      () => coordinator.status(options.filename),
      /absent from its database ledger/
    )
    fs.writeFileSync(options.filename, original)
    await assert.rejects(
      () =>
        coordinator.run({
          ...options,
          timeoutMs: 100,
          preparePlan: () => new Promise(() => {})
        }),
      /deadline/
    )
    assert.deepEqual(coordinator.status(options.filename).applied, [])
    fs.rmSync(
      path.join(backupSet.directory, backupSet.receipt.snapshots[0].file)
    )
    await assert.rejects(() => coordinator.run(options), /ENOENT/)
    databases.forEach((item) =>
      assert.equal(inspect(item.path).columns.includes('note'), false)
    )
  }))
