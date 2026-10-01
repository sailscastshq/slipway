const { test } = require('sounding')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const command = promisify(execFile)
test(
  'a stored PostgreSQL backup restores readable data in isolation and cleans up success, corruption and cancellation',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'restore-contract' } }
    }
  },
  async ({ sails, world }) => {
    const S3rver = require(path.join(
      process.env.SLIPWAY_STORAGE_EMULATORS,
      's3rver'
    ))
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-contract-'))
    const server = new S3rver({
      address: '127.0.0.1',
      port: 0,
      silent: true,
      directory: root,
      configureBuckets: [{ name: 'private-backups' }]
    })
    server.middleware.unshift(async (ctx, next) => {
      if (!ctx.get('authorization') && !ctx.query['X-Amz-Signature']) {
        ctx.status = 403
        return
      }
      await next()
    })
    const docker = sails.config.docker?.binaryPath || 'docker'
    const run = (args) =>
      command(docker, args, { timeout: 30000, maxBuffer: 1048576 })
    const source = `slipway-restore-source-${randomUUID()}`
    const originalProcess = sails.helpers.streams.runProcess
    const tested = []
    let created = false
    try {
      const address = await server.run()
      await sails.helpers.setting.set(
        'backupStorageConfig',
        JSON.stringify({
          provider: 's3',
          bucket: 'private-backups',
          region: 'us-east-1',
          endpoint: `http://127.0.0.1:${address.port}`,
          key: 'S3RVER',
          secret: 'S3RVER',
          forcePathStyle: true
        })
      )
      const image =
        process.env.SLIPWAY_RESTORE_TEST_IMAGE || 'postgres:15-alpine'
      const imageId = (
        await run(['image', 'inspect', image, '--format', '{{.Id}}'])
      ).stdout.trim()
      await run([
        'run',
        '-d',
        '--name',
        source,
        '--network',
        'none',
        '--memory',
        '256m',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,size=134217728',
        '-e',
        'POSTGRES_PASSWORD=fixture-password',
        imageId
      ])
      created = true
      const sql = (query) =>
        run([
          'exec',
          '-e',
          'PGPASSWORD=fixture-password',
          source,
          'psql',
          '-h',
          '127.0.0.1',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-tAc',
          query
        ])
      for (let i = 0; i < 60; i++) {
        try {
          await sql('SELECT 1')
          break
        } catch (cause) {
          if (i === 59) throw cause
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
      await sql(
        "CREATE TABLE sample(id integer PRIMARY KEY, label text); INSERT INTO sample VALUES (1,'one'),(2,'two');"
      )
      const service = await world.create('service').with({
        environment: world.current.environments.production.id,
        name: 'primary-db',
        type: 'postgresql',
        version: '15',
        status: 'running',
        containerName: source,
        imageReference: imageId,
        database: 'postgres',
        username: 'postgres',
        password: 'fixture-password'
      })
      const pending = await world
        .create('backup')
        .with({ service: service.id, type: 'manual' })
      const backup = await sails.helpers.backup.runBackup(String(pending.id))
      assert.equal(backup.status, 'completed', backup.errorMessage)
      assert.ok(backup.storage.checksum)
      assert.equal(backup.storage.database.imageReference, imageId)
      await sql("INSERT INTO sample VALUES(3,'after backup')")
      // Moving current storage must not change how this saved object is downloaded.
      await sails.helpers.setting.set(
        'backupStorageConfig',
        JSON.stringify({
          provider: 's3',
          bucket: 'different-bucket',
          region: 'us-east-1',
          key: 'wrong',
          secret: 'wrong'
        })
      )
      const make = async () => {
        const operation = await sails.models.restoretest
          .create({
            backup: backup.id,
            service: service.id,
            team: world.current.teams.genesisTeam.id,
            status: 'running',
            stage: 'preparing',
            resourceName: `slipway-restore-test-${randomUUID()}`,
            startedAt: Date.now()
          })
          .fetch()
        tested.push(operation)
        return operation
      }
      let restoredCount, cancelAfterCreate
      const observe = async (inputs) => {
        const result = await originalProcess.with(inputs)
        if (cancelAfterCreate && inputs.args[0] === 'run')
          cancelAfterCreate.abort()
        if (inputs.args.at(-1)?.startsWith('DO $$')) {
          const check = await originalProcess.with({
            ...inputs,
            args: [...inputs.args.slice(0, -1), 'SELECT count(*) FROM sample']
          })
          restoredCount = Number(check.stdout.trim())
        }
        return result
      }
      observe.with = observe
      sails.helpers.streams.runProcess = observe
      const operation = await make()
      await sails.helpers.backup.runRestoreTest.with({ testId: operation.id })
      const completed = await sails.models.restoretest.findOne({
        id: operation.id
      })
      assert.equal(completed.status, 'completed', completed.error)
      assert.equal(completed.cleanupPending, false)
      assert.equal(completed.report.tablesChecked, 1)
      assert.equal(
        restoredCount,
        2,
        'restored records are from the selected snapshot, not the live database'
      )
      assert.equal(completed.report.cleanup, 'removed')
      assert.ok(completed.report.checks.includes('SHA-256 checksum verified'))
      assert.equal(
        (await sql('SELECT count(*) FROM sample')).stdout.trim(),
        '3'
      )
      assert.equal(
        (await sails.models.service.findOne({ id: service.id })).status,
        'running'
      )
      // The empty-state action is one durable server-owned backup-and-test flow.
      const boundConfig = await sails.helpers.backup.getStorageConfig(
        String(backup.id)
      )
      await sails.helpers.setting.set(
        'backupStorageConfig',
        JSON.stringify(boundConfig)
      )
      const fresh = await sails.helpers.backup.manageRestoreTests.with({
        action: 'enqueue',
        serviceId: service.id,
        teamId: world.current.teams.genesisTeam.id,
        userId: world.current.users.genesisUser.id
      })
      tested.push(fresh)
      let freshResult
      for (let i = 0; i < 600; i++) {
        freshResult = await sails.models.restoretest.findOne({ id: fresh.id })
        if (!['queued', 'running'].includes(freshResult.status)) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.equal(freshResult.status, 'completed', freshResult.error)
      assert.notEqual(fresh.backup, backup.id)
      assert.equal(
        restoredCount,
        3,
        'fresh backup and restore test captures the newer live data'
      )
      assert.equal(
        (await sails.models.backup.findOne({ id: fresh.backup })).status,
        'completed'
      )
      // A genuine checksum mismatch must never report recovery as verified.
      await sails.models.backup
        .updateOne({ id: backup.id })
        .set({ storage: { ...backup.storage, checksum: 'wrong-checksum' } })
      const corrupt = await make()
      await sails.helpers.backup.runRestoreTest.with({ testId: corrupt.id })
      const failed = await sails.models.restoretest.findOne({ id: corrupt.id })
      assert.equal(failed.status, 'failed')
      assert.equal(failed.report.failedStage, 'download')
      assert.equal(failed.cleanupPending, false)
      const cancelled = await make()
      const controller = new AbortController()
      cancelAfterCreate = controller
      await sails.helpers.backup.runRestoreTest.with({
        testId: cancelled.id,
        signal: controller.signal
      })
      assert.equal(
        (await sails.models.restoretest.findOne({ id: cancelled.id })).status,
        'cancelled'
      )
      // Simulate a server stop after a target and download directory were created.
      cancelAfterCreate = null
      const orphan = await make()
      await run([
        'run',
        '-d',
        '--name',
        orphan.resourceName,
        '--label',
        `slipway.restore-test=${orphan.id}`,
        '--label',
        `slipway.restore-test.resource=${orphan.resourceName}`,
        '--network',
        'none',
        '--entrypoint',
        'sh',
        imageId,
        '-c',
        'sleep 60'
      ])
      const leftover = path.join(os.tmpdir(), orphan.resourceName)
      await fs.mkdir(leftover, { mode: 0o700 })
      await fs.writeFile(
        path.join(leftover, 'database.dmp'),
        'partial download'
      )
      await sails.helpers.backup.manageRestoreTests.with({ action: 'recover' })
      const recovered = await sails.models.restoretest.findOne({
        id: orphan.id
      })
      assert.equal(recovered.status, 'interrupted')
      assert.equal(recovered.cleanupPending, false)
      await assert.rejects(fs.access(leftover))
      // A foreign resource with the same name must never be removed by cleanup.
      const foreign = await make()
      await run([
        'run',
        '-d',
        '--name',
        foreign.resourceName,
        '--label',
        'slipway.restore-test=foreign',
        '--network',
        'none',
        '--entrypoint',
        'sh',
        imageId,
        '-c',
        'sleep 60'
      ])
      await assert.rejects(
        sails.helpers.backup.cleanupRestoreTest(foreign),
        /ownership/
      )
      assert.ok(
        (
          await run([
            'ps',
            '-a',
            '--filter',
            `name=^/${foreign.resourceName}$`,
            '--format',
            '{{.ID}}'
          ])
        ).stdout.trim()
      )
      await run(['rm', '-f', foreign.resourceName])
      await sails.models.restoretest
        .updateOne({ id: foreign.id })
        .set({ status: 'failed', stage: 'failed' })
      for (const item of tested)
        assert.equal(
          (
            await run([
              'ps',
              '-a',
              '--filter',
              `name=^/${item.resourceName}$`,
              '--format',
              '{{.ID}}'
            ])
          ).stdout.trim(),
          ''
        )
      await sql("INSERT INTO sample VALUES(4,'still writable')")
      assert.equal(
        (await sql('SELECT count(*) FROM sample')).stdout.trim(),
        '4'
      )
    } finally {
      sails.helpers.streams.runProcess = originalProcess
      for (const item of tested)
        await run(['rm', '-f', item.resourceName]).catch(() => {})
      if (created) await run(['rm', '-f', source])
      await server.close().catch(() => {})
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
