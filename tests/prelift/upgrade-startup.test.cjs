const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const startup = require('../../api/lib/upgrade-startup')
const { fixture, complete, profiles } = require('./release-fixtures.cjs')
test('startup admission checks completed native receipts and blocks held/wrong version checkpoints', () =>
  fixture(profiles.old, async (state) => {
    const identity = await complete(state)
    const run = fs
      .readdirSync(state.directory)
      .find((name) => name.startsWith('run-'))
    const filename = path.join(state.directory, run, 'run.json')
    const markerFile = path.join(state.directory, 'launch.json')
    const marker = {
      format: 1,
      phase: 'publishing',
      filename,
      instanceId: 'fixture-instance',
      version: identity.manifest.version,
      image: identity.manifest.image,
      manifestHash: identity.hash
    }
    startup.writeMarker(markerFile, marker)
    const options = {
      markerFile,
      instanceId: marker.instanceId,
      version: marker.version,
      image: marker.image,
      manifestHash: marker.manifestHash
    }
    assert.equal(startup.verify(options).verified, true)
    const targets = require('../../api/lib/upgrade-coordinator').readJournal(
      filename
    ).targets
    const datastores = Object.fromEntries(
      targets.map((target) => [
        target.datastore,
        { adapter: 'sails-sqlite', url: target.path }
      ])
    )
    assert.equal(startup.verify({ ...options, datastores }).verified, true)
    datastores.default.url = datastores.observability.url
    assert.throws(() => startup.verify({ ...options, datastores }), {
      code: 'upgradeNotReady'
    })
    assert.throws(() => startup.verify({ ...options, version: '0.0.89' }), {
      code: 'upgradeNotReady'
    })
    startup.writeMarker(markerFile, { ...marker, phase: 'hold' })
    assert.throws(() => startup.verify(options), { code: 'upgradeNotReady' })
  }))
test('normal app and Sails config reject missing annotated checkpoint before ORM and jobs', () => {
  for (const input of [
    { entry: 'app.js' },
    { code: 'require("./config/datastores")' }
  ]) {
    const result = spawnSync(
      process.execPath,
      input.entry ? [input.entry] : ['-e', input.code],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5000,
        env: {
          PATH: process.env.PATH,
          SLIPWAY_UPGRADE_MARKER: '/missing-upgrade-marker',
          SLIPWAY_UPGRADE_IMAGE: `ghcr.io/sailscastshq/slipway@sha256:${'a'.repeat(
            64
          )}`
        }
      }
    )
    assert.equal(result.status, 1)
    assert.ok((result.stderr + result.stdout).includes('upgradeNotReady'))
    assert.ok(!(result.stderr + result.stdout).includes('Starting app'))
  }
})
test('coordinated production cannot enable ORM alter through legacy environment override', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', 'console.log(require("./config/env/production").models.migrate)'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SLIPWAY_UPGRADE_MARKER: '/marker',
        SLIPWAY_MIGRATE: 'alter'
      }
    }
  )
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), 'safe')
})
