const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const host = require('../../api/lib/upgrade-host-controller')
const driverFactory = require('../../api/lib/upgrade-host-driver')
const docker = require('../../api/lib/upgrade-docker-api')()
const { fixture, profiles } = require('./release-fixtures.cjs')
const enabled =
  process.platform === 'linux' && process.env.SLIPWAY_HOST_FIXTURE === '1'
function cli(...args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30000
  }).trim()
}
test(
  'Linux host handoff preserves original storage and reconciles real Docker launch/health failure',
  { skip: !enabled, timeout: 120000 },
  async () => {
    assert.equal(process.getuid(), 0)
    await fixture(profiles.old, async ({ directory }) => {
      const original = path.join(directory, 'original')
      const stateRoot = path.join(directory, 'upgrades')
      fs.mkdirSync(original, { mode: 0o700 })
      fs.mkdirSync(stateRoot, { mode: 0o700 })
      for (const [from, to] of [
        ['default.db', 'app.db'],
        ['observability.db', 'observability.db'],
        ['analytics.db', 'analytics.db'],
        ['cache.db', 'stash.db']
      ])
        fs.renameSync(path.join(directory, from), path.join(original, to))
      fs.writeFileSync(
        path.join(original, 'private-key'),
        'synthetic-existing-private-key',
        { mode: 0o600 }
      )
      const sessions = new Database(path.join(original, 'session.db'))
      sessions.exec(
        "CREATE TABLE sessions(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sessions(value) VALUES('synthetic-existing-session')"
      )
      sessions.close()
      const image = cli(
        'image',
        'inspect',
        '--format',
        '{{index .RepoDigests 0}}',
        'node:22-bookworm-slim'
      )
      const imageInfo = await docker(
        'GET',
        `/images/${encodeURIComponent(image)}/json`
      )
      const name = 'slipway-host-fixture-' + process.pid
      let sourceId
      let targetId
      try {
        sourceId = cli(
          'run',
          '-d',
          '--name',
          name,
          '--restart=always',
          '--mount',
          `type=bind,src=${process.cwd()},dst=/app,readonly`,
          '--mount',
          `type=bind,src=${original},dst=/app/db`,
          '--workdir',
          '/app',
          '-e',
          'SESSION_SECRET=synthetic-existing-session-secret-value',
          '-e',
          'DATA_ENCRYPTION_KEY=synthetic-existing-encryption-key',
          image,
          'node',
          'tests/prelift/fixtures/upgrade-old-writer.cjs'
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
        const current = await docker('GET', `/containers/${sourceId}/json`)
        assert.equal(current.State.Running, true)
        const reviewed = host.plan({
          sourceDirectory: original,
          instanceId: 'linux-host-fixture',
          image,
          sourceVersion: '0.0.86',
          containerId: sourceId,
          containerName: name
        })
        const driver = driverFactory({
          docker,
          directory: stateRoot,
          current,
          imageId: imageInfo.Id,
          imageConfig: {
            ...imageInfo.Config,
            WorkingDir: '/app',
            Cmd: ['node', 'tests/prelift/fixtures/upgrade-ready-server.cjs']
          }
        })
        const verifyFence = driver.verifyFence
        driver.verifyFence = async (input) => {
          try {
            return await verifyFence(input)
          } catch (error) {
            // Fixture diagnostics are machine codes/phase only, never Docker
            // configuration, exception messages, SQL or copied file contents.
            console.log(
              JSON.stringify({
                fixtureFenceFailure: error.code || 'unknown',
                reason: error.reason,
                datastores: input.targets.map((item) => item.datastore),
                hasWorker: Boolean(input.worker?.workerPid)
              })
            )
            throw error
          }
        }
        const realHealth = driver.health
        driver.health = async () => ({ ready: false })
        let failed
        try {
          await host.apply({
            reviewed,
            approval: reviewed.reviewHash,
            directory: stateRoot,
            driver,
            timeoutMs: 60000,
            maxBytes: 100 * 1024 * 1024
          })
        } catch (error) {
          failed = error
        }
        if (failed?.code !== 'upgradeHostHealth')
          console.log(
            JSON.stringify({
              fixtureHostFailure: failed?.code,
              phase: failed?.filename
                ? host.status(failed.filename).phase
                : 'unrecorded',
              migration: failed?.filename
                ? host.status(failed.filename).migration?.phase
                : null
            })
          )
        assert.equal(failed.code, 'upgradeHostHealth')
        const held = host.read(failed.filename)
        targetId = held.target.id
        assert.equal(host.status(failed.filename).migration.pending.length, 0)
        const originalAfter = await docker(
          'GET',
          `/containers/${sourceId}/json`
        )
        const targetAfter = await docker('GET', `/containers/${targetId}/json`)
        assert.equal(originalAfter.State.Running, false)
        assert.equal(originalAfter.HostConfig.RestartPolicy.Name, 'no')
        assert.equal(targetAfter.State.Running, false)
        assert.equal(targetAfter.HostConfig.RestartPolicy.Name, 'no')
        assert.ok(
          targetAfter.Config.Env.includes(
            'SESSION_SECRET=synthetic-existing-session-secret-value'
          )
        )
        assert.ok(
          targetAfter.Config.Env.includes(
            'DATA_ENCRYPTION_KEY=synthetic-existing-encryption-key'
          )
        )
        assert.equal(
          fs.readFileSync(
            path.join(held.stage.dataDirectory, 'private-key'),
            'utf8'
          ),
          'synthetic-existing-private-key'
        )
        assert.ok(fs.existsSync(held.backupSet.directory))
        driver.health = realHealth
        const result = await host.resume({
          filename: failed.filename,
          expectedReviewHash: reviewed.reviewHash,
          driver,
          timeoutMs: 60000
        })
        assert.equal(result.phase, 'ready')
        const restarted = await docker('GET', `/containers/${targetId}/json`)
        assert.equal(restarted.State.Running, true)
        assert.equal(restarted.HostConfig.RestartPolicy.Name, 'always')
        assert.equal(
          (await docker('GET', `/containers/${sourceId}/json`)).State.Running,
          false
        )
        assert.equal(
          (
            await docker(
              'GET',
              '/containers/json?all=1&filters=' +
                encodeURIComponent(
                  JSON.stringify({
                    label: [`io.slipway.upgrade.run=${held.id}`]
                  })
                )
            )
          ).length,
          1
        )
        // The original database has no upgrade receipt or new release tables.
        const originalDb = new Database(path.join(original, 'app.db'), {
          readonly: true
        })
        assert.equal(
          originalDb
            .prepare(
              "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='_slipway_upgrade_ledger_v1'"
            )
            .get().count,
          0
        )
        originalDb.close()
      } finally {
        for (const id of [targetId, sourceId].filter(Boolean))
          cli('rm', '-f', id)
      }
    })
  }
)
