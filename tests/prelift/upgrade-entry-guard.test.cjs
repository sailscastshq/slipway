const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Database = require('better-sqlite3')
const { coordinatorFixture } = require('./upgrade-fixtures.cjs')
const coordinator = require('../../api/lib/upgrade-coordinator')
const guard = require('../../api/lib/upgrade-entry-guard')
function expected({ options, identity }) {
  return {
    filename: options.filename,
    instanceId: options.expectedInstanceId,
    manifestHash: identity.hash,
    version: identity.manifest.version,
    image: identity.manifest.image
  }
}
test('normal-entry compatibility verifies the complete native checkpoint without writing any file', () =>
  coordinatorFixture(async (state) => {
    await coordinator.run(state.options)
    const files = [
      state.options.filename,
      ...state.databases.map((item) => item.path)
    ]
    const before = files.map((file) => fs.readFileSync(file))
    const receipt = guard(expected(state))
    assert.equal(receipt.verified, true)
    assert.equal(global.sails, undefined)
    files.forEach((file, index) =>
      assert.deepEqual(fs.readFileSync(file), before[index])
    )
  }))
test('missing, incomplete, drifted and differently targeted checkpoints fail before ORM or jobs can start', () =>
  coordinatorFixture(async (state) => {
    const request = expected(state)
    assert.throws(() => guard(request), { code: 'upgradeNotReady' })
    assert.throws(
      () => guard({ ...request, filename: '/missing-upgrade-journal' }),
      { code: 'upgradeNotReady' }
    )
    await coordinator.run(state.options)
    for (const field of ['instanceId', 'manifestHash', 'version', 'image'])
      assert.throws(() => guard({ ...request, [field]: 'different' }), {
        code: 'upgradeNotReady'
      })
    const db = new Database(state.databases[0].path)
    db.exec('ALTER TABLE notes ADD COLUMN drift TEXT')
    db.close()
    assert.throws(() => guard(request), { code: 'upgradeNotReady' })
  }))
test('a committed prefix awaiting recovery cannot be treated as healthy by any entrypoint', () =>
  coordinatorFixture(async (state) => {
    await assert.rejects(
      () =>
        coordinator.run({
          ...state.options,
          afterCheckpoint: async () => {
            throw new Error('interrupted')
          }
        }),
      /interrupted/
    )
    assert.deepEqual(coordinator.status(state.options.filename).applied, [
      'default'
    ])
    assert.throws(() => guard(expected(state)), { code: 'upgradeNotReady' })
  }))
