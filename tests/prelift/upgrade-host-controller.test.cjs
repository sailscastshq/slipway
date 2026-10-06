const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const host = require('../../api/lib/upgrade-host-controller')
const registry = require('../../api/lib/upgrade-registry')
const { fixture, image } = require('./release-fixtures.cjs')
const old = require('../../api/lib/upgrades/baselines/0.0.86.json')
async function runFixture(run, profile = old) {
  return fixture(profile, async ({ directory }) => {
    // The release fixture supplies the same catalogs under logical names;
    // installation storage uses the canonical physical filenames.
    fs.renameSync(
      path.join(directory, 'default.db'),
      path.join(directory, 'app.db')
    )
    fs.renameSync(
      path.join(directory, 'cache.db'),
      path.join(directory, 'stash.db')
    )
    const source = path.join(directory, 'source')
    const stateDirectory = path.join(directory, 'upgrades')
    fs.mkdirSync(source, { mode: 0o700 })
    fs.mkdirSync(stateDirectory, { mode: 0o700 })
    for (const file of [
      'app.db',
      'observability.db',
      'analytics.db',
      'stash.db'
    ])
      fs.renameSync(path.join(directory, file), path.join(source, file))
    fs.writeFileSync(
      path.join(source, 'session.db'),
      'opaque-existing-session-fixture'
    )
    fs.writeFileSync(
      path.join(source, 'private-key'),
      'opaque-existing-private-key'
    )
    const reviewed = host.plan({
      sourceDirectory: source,
      instanceId: 'fixture-instance',
      image,
      sourceVersion: profile === null ? 'fresh' : '0.0.87',
      containerId: 'a'.repeat(64)
    })
    const events = []
    const driver = {
      acquire: async ({ id }) => {
        events.push('acquire')
        return { id, owner: 'fixture-exclusive-controller' }
      },
      freeze: async () => {
        events.push('freeze')
      },
      verifyFence: async ({ control, targets, context }) => ({
        id: control.id,
        writersStopped: true,
        exclusiveController: true,
        controllerOwner: control.owner,
        databaseKeys: targets.map((item) => item.databaseKey),
        previousOwnerStopped: context?.previousOwner ? true : undefined
      }),
      publish: async ({ state }) => {
        events.push('publish')
        assert.equal(state.phase, 'publishing')
        assert.equal(
          require('../../api/lib/upgrade-coordinator').status(
            state.handle.filename
          ).phase,
          'completed'
        )
        return { id: 'fixture-new-container' }
      },
      health: async ({ state }) => {
        events.push('health')
        return {
          ready: true,
          instanceId: state.reviewed.instanceId,
          image: state.reviewed.identity.manifest.image,
          manifestHash: state.reviewed.identity.hash
        }
      },
      release: async () => {
        events.push('release')
      }
    }
    const options = {
      reviewed,
      approval: reviewed.reviewHash,
      directory: stateDirectory,
      driver,
      timeoutMs: 30000,
      maxBytes: 50 * 1024 * 1024
    }
    await run({ options, events, source, driver, reviewed, stateDirectory })
  })
}
test('host controller migrates staged storage and publishes only after complete receipts', () =>
  runFixture(async ({ options, events, source }) => {
    const result = await host.apply(options)
    assert.equal(result.phase, 'ready')
    assert.equal(result.migration.phase, 'completed')
    assert.deepEqual(events, [
      'acquire',
      'freeze',
      'publish',
      'health',
      'release'
    ])
    assert.equal(
      registry.createReleasePlan({
        services: host.services(source, 'fixture-instance'),
        instanceId: 'fixture-instance',
        image
      }).hash,
      options.reviewed.identity.hash
    )
    const state = host.read(result.filename)
    assert.equal(
      fs.readFileSync(
        path.join(state.stage.dataDirectory, 'private-key'),
        'utf8'
      ),
      'opaque-existing-private-key'
    )
    assert.equal(
      fs.readFileSync(
        path.join(state.stage.dataDirectory, 'session.db'),
        'utf8'
      ),
      'opaque-existing-session-fixture'
    )
  }))
test('failed target health keeps both storage trees and resumes the committed checkpoint', () =>
  runFixture(async ({ options, driver, events, source }) => {
    const healthy = driver.health
    driver.health = async () => ({ ready: false })
    let failure
    try {
      await host.apply(options)
    } catch (error) {
      failure = error
    }
    assert.equal(failure.code, 'upgradeHostHealth')
    const before = host.status(failure.filename)
    assert.equal(before.phase, 'recoveryRequired')
    assert.equal(before.migration.pending.length, 0)
    const state = host.read(failure.filename)
    assert.ok(fs.existsSync(source))
    assert.ok(fs.existsSync(state.stage.dataDirectory))
    assert.ok(fs.existsSync(state.backupSet.directory))
    driver.health = healthy
    const after = await host.resume({
      filename: failure.filename,
      expectedReviewHash: options.reviewed.reviewHash,
      driver,
      timeoutMs: 30000
    })
    assert.equal(after.phase, 'ready')
    assert.equal(after.errorCode, null)
    assert.equal(after.errorReason, null)
    assert.ok(!events.includes('restore'))
  }))
test('wrong review approval fails before stopping writers or creating host state', () =>
  runFixture(async ({ options, events, stateDirectory }) => {
    await assert.rejects(host.apply({ ...options, approval: 'wrong-review' }), {
      code: 'upgradeHostApproval'
    })
    assert.deepEqual(events, [])
    assert.deepEqual(fs.readdirSync(stateDirectory), [])
  }))
test('unproved exclusive launch control blocks before staging and publication', () =>
  runFixture(async ({ options, driver, events }) => {
    driver.verifyFence = async () => ({
      writersStopped: true,
      exclusiveController: false
    })
    await assert.rejects(host.apply(options), { code: 'upgradeFenceLost' })
    assert.deepEqual(events, ['acquire', 'freeze', 'release'])
  }))
test('late writes to original storage block publication after committed staged DDL', () =>
  runFixture(async ({ options, driver, source, events }) => {
    const fence = driver.verifyFence
    let calls = 0
    driver.verifyFence = async (input) => {
      calls++
      if (calls === 10)
        fs.writeFileSync(path.join(source, 'late-write'), 'do-not-lose')
      return fence(input)
    }
    await assert.rejects(host.apply(options), {
      code: 'upgradeStorageMismatch'
    })
    assert.ok(!events.includes('publish'))
    assert.equal(
      fs.readFileSync(path.join(source, 'late-write'), 'utf8'),
      'do-not-lose'
    )
  }))

test('fresh host initialization completes all native receipts before publication without ORM', () =>
  runFixture(async ({ options, source }) => {
    const result = await host.apply(options)
    assert.equal(result.phase, 'ready')
    assert.equal(result.migration.pending.length, 0)
    assert.equal(options.reviewed.identity.manifest.mode, 'fresh')
    for (const service of host.services(source, 'fixture-instance')) {
      const db = new (require('better-sqlite3'))(service.path, {
        readonly: true
      })
      assert.equal(
        db
          .prepare(
            "SELECT count(*) AS n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'"
          )
          .get().n,
        0
      )
      db.close()
    }
  }, null))
test('a completed coordinated host can transition to another pinned image preserving prior receipts', () =>
  runFixture(async ({ options, driver, stateDirectory }) => {
    const first = await host.apply(options)
    const prior = host.read(first.filename)
    const nextImage = `ghcr.io/sailscastshq/slipway@sha256:${'b'.repeat(64)}`
    const reviewed = host.plan({
      sourceDirectory: prior.stage.dataDirectory,
      instanceId: first.instanceId,
      image: nextImage,
      sourceVersion: registry.release,
      containerId: 'b'.repeat(64),
      previous: prior.reviewed.identity
    })
    assert.equal(
      reviewed.identity.manifest.previous.hash,
      prior.reviewed.identity.hash
    )
    const next = await host.apply({
      ...options,
      reviewed,
      approval: reviewed.reviewHash,
      directory: stateDirectory,
      driver
    })
    assert.equal(next.phase, 'ready')
    const state = host.read(next.filename)
    const ledger = require('../../api/lib/upgrade-ledger')
    for (const service of host.services(
      state.stage.dataDirectory,
      next.instanceId
    )) {
      const db = new (require('better-sqlite3'))(service.path, {
        readonly: true
      })
      assert.equal(
        ledger.readLedger(
          db,
          prior.reviewed.identity,
          service.datastore,
          service.databaseKey
        ).length,
        1
      )
      assert.equal(
        ledger.readLedger(
          db,
          reviewed.identity,
          service.datastore,
          service.databaseKey
        ).length,
        1
      )
      db.close()
    }
  }))

test('unobservable host preflight retains a reviewed checkpoint without freezing or staging the source', () =>
  runFixture(async ({ options, events, driver, source }) => {
    driver.acquire = async () => {
      throw Object.assign(new Error('unconfirmed'), {
        code: 'upgradeFenceUnproved',
        reason: 'procUnobservable'
      })
    }
    let failure
    try {
      await host.apply(options)
    } catch (error) {
      failure = error
    }
    assert.equal(failure.code, 'upgradeFenceUnproved')
    assert.equal(failure.reason, 'procUnobservable')
    assert.deepEqual(events, [])
    const state = host.read(failure.filename)
    assert.equal(state.phase, 'recoveryRequired')
    assert.equal(state.errorReason, 'procUnobservable')
    assert.equal(state.stage, null)
    assert.ok(fs.existsSync(source))
  }))
