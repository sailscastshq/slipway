const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const initialize = require('../fixtures/native-upgrade/initialize.cjs')
const startup = require('../../api/lib/upgrade-startup')
const ledger = require('../../api/lib/upgrade-ledger')

test('ordinary versioned fixtures obtain actual four-database receipts and enforce inode, safe ORM and marker admission', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-init-contract-'))
  fs.chmodSync(root, 0o700)
  try {
    const filename = await initialize(root)
    const descriptor = JSON.parse(fs.readFileSync(filename))
    const options = {
      markerFile: descriptor.env.SLIPWAY_UPGRADE_MARKER,
      version: require('../../package.json').version,
      image: descriptor.env.SLIPWAY_UPGRADE_IMAGE,
      instanceId: descriptor.env.SLIPWAY_UPGRADE_INSTANCE,
      manifestHash: descriptor.env.SLIPWAY_UPGRADE_MANIFEST,
      datastores: descriptor.datastores
    }
    assert.equal(descriptor.models.migrate, 'safe')
    assert.equal(startup.verify(options).verified, true)
    const expected = require('../../api/lib/upgrades/baselines/current-fresh.json')
    assert.deepEqual(Object.keys(descriptor.datastores).sort(), [
      'analytics',
      'cache',
      'default',
      'observability'
    ])
    for (const [name, service] of Object.entries(descriptor.datastores)) {
      const db = new Database(service.url, {
        readonly: true,
        fileMustExist: true
      })
      try {
        assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
        assert.equal(
          ledger.schemaHash({
            path: service.url,
            transaction: { database: db }
          }),
          expected.databases[name].schemaHash
        )
        assert.ok(
          db.prepare(`SELECT COUNT(*) AS n FROM ${ledger.table}`).get().n > 0
        )
      } finally {
        db.close()
      }
    }
    const altered = structuredClone(descriptor.datastores)
    altered.default.url = altered.observability.url
    assert.throws(() => startup.verify({ ...options, datastores: altered }), {
      code: 'upgradeNotReady'
    })
    assert.throws(
      () => startup.verify({ ...options, manifestHash: '0'.repeat(64) }),
      { code: 'upgradeNotReady' }
    )
    const saved = Object.fromEntries(
      Object.keys(descriptor.env).map((name) => [name, process.env[name]])
    )
    try {
      Object.assign(process.env, descriptor.env)
      const hook = require('../../api/hooks/upgrade-admission')({
        config: {
          datastores: descriptor.datastores,
          models: { migrate: 'drop' }
        }
      })
      assert.throws(() => hook.configure(), { code: 'upgradeNotReady' })
      const sails = {
        config: {
          datastores: descriptor.datastores,
          models: { migrate: 'safe' }
        }
      }
      require('../../api/hooks/upgrade-admission')(sails).configure()
      assert.equal(sails.upgradeAdmission.verified, true)
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
    const original = descriptor.datastores.default.url
    fs.copyFileSync(original, original + '.replacement')
    fs.renameSync(original + '.replacement', original)
    assert.throws(() => startup.verify(options), { code: 'upgradeNotReady' })
    await assert.rejects(initialize(root), /Fresh private fixture/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
