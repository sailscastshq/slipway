const { test } = require('sounding')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const { createWriteStream } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const run = promisify(execFile)
const connection = require('../../api/lib/external-postgresql')
test(
  'isolated external PostgreSQL verifies TLS and permissions and cleans up bounded dumps',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'external-pg-container' } }
    }
  },
  async ({ sails, world }) => {
    const image = process.env.SLIPWAY_EXTERNAL_PG_IMAGE || 'postgres:17-alpine'
    const docker = sails.config.docker?.binaryPath || 'docker'
    const name = `slipway-external-test-${randomUUID()}`
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'slipway-external-test-')
    )
    const priorNetwork = sails.config.custom.externalDatabaseClientNetwork
    sails.config.custom.externalDatabaseClientNetwork = 'bridge'
    const command = (args) =>
      run(docker, args, { timeout: 30000, maxBuffer: 1024 * 1024 })
    let created = false
    try {
      const imageReference = (
        await command(['image', 'inspect', image, '--format', '{{.Id}}'])
      ).stdout.trim()
      await command([
        'run',
        '-d',
        '--name',
        name,
        '--network',
        'bridge',
        '--memory',
        '256m',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,size=128m',
        '-e',
        'POSTGRES_PASSWORD=fixture-password',
        image
      ])
      created = true
      let ready = false
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          await command([
            'exec',
            name,
            'psql',
            '-U',
            'postgres',
            '-d',
            'postgres',
            '-c',
            'SELECT 1'
          ])
          ready = true
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }
      assert.ok(ready, 'PostgreSQL starts')
      const host = (
        await command([
          'inspect',
          name,
          '--format',
          '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
        ])
      ).stdout.trim()
      await command([
        'exec',
        name,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        "CREATE TABLE sample AS SELECT i, repeat(md5(i::text),100) AS payload FROM generate_series(1,1000) i; CREATE ROLE restricted LOGIN PASSWORD 'restricted-password';"
      ])
      const config = connection.parse({
        dsn: `postgresql://postgres:fixture-password@${host}/postgres`,
        sslMode: 'disable',
        allowInsecure: true
      })
      const service = await world.create('service').with({
        environment: world.current.environments.production.id,
        name: 'external-db',
        version: 'external',
        managementMode: 'external',
        status: 'unverified',
        externalConnection: config,
        imageReference
      })
      const verify = () =>
        sails.helpers.service.verifyExternal(String(service.id))
      assert.equal((await verify()).status, 'reachable')
      await verifyBackupLifecycle(sails, world, service, root)
      const destination = path.join(root, 'dump.dmp')
      await sails.helpers.service.runExternalClient.with({
        serviceId: String(service.id),
        operation: 'dump',
        output: createWriteStream(destination, { mode: 0o600 }),
        maxBytes: 1024 * 1024,
        timeoutMs: 30000
      })
      assert.equal(
        (await fs.readFile(destination)).subarray(0, 5).toString(),
        'PGDMP'
      )
      await command(['cp', destination, `${name}:/tmp/restore.dmp`])
      await command(['exec', name, 'createdb', '-U', 'postgres', 'restored'])
      await command([
        'exec',
        name,
        'pg_restore',
        '-U',
        'postgres',
        '--dbname',
        'restored',
        '/tmp/restore.dmp'
      ])
      assert.equal(
        (
          await command([
            'exec',
            name,
            'psql',
            '-U',
            'postgres',
            '-d',
            'restored',
            '-tAc',
            'SELECT count(*) FROM sample'
          ])
        ).stdout.trim(),
        '1000'
      )
      for (const [changes, code] of [
        [{ host: 'missing.invalid' }, 'EXTERNAL_DNS'],
        [{ port: 1 }, 'EXTERNAL_TCP'],
        [{ password: 'wrong' }, 'EXTERNAL_AUTHENTICATION'],
        [
          { username: 'restricted', password: 'restricted-password' },
          'EXTERNAL_PERMISSION'
        ],
        [{ sslMode: 'verify-full' }, 'EXTERNAL_TLS']
      ]) {
        await sails.models.service
          .updateOne({ id: service.id })
          .set({ externalConnection: { ...config, ...changes } })
        const failed = await verify()
        assert.equal(failed.status, 'unreachable')
        assert.equal(failed.code, code, JSON.stringify(failed))
        assert.equal(JSON.stringify(failed).includes('fixture-password'), false)
      }
      await sails.models.service
        .updateOne({ id: service.id })
        .set({ externalConnection: config })
      await assert.rejects(
        sails.helpers.service.runExternalClient.with({
          serviceId: String(service.id),
          operation: 'dump',
          output: createWriteStream(path.join(root, 'oversized.dmp')),
          maxBytes: 16,
          timeoutMs: 30000
        }),
        { code: 'STREAM_SIZE_LIMIT' }
      )
      await assert.rejects(
        sails.helpers.service.runExternalClient.with({
          serviceId: String(service.id),
          operation: 'verify',
          timeoutMs: 1
        }),
        { code: 'STREAM_TIMEOUT' }
      )
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(
        sails.helpers.service.runExternalClient.with({
          serviceId: String(service.id),
          operation: 'verify',
          signal: controller.signal
        }),
        { code: 'STREAM_ABORTED' }
      )
      // Hold a real table lock so cancellation interrupts a running dump.
      await command([
        'exec',
        '-d',
        name,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        "SET application_name='slipway-cancel-fixture'; BEGIN; LOCK TABLE sample IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(30);"
      ])
      for (let attempt = 0; attempt < 30; attempt++) {
        const locked = await command([
          'exec',
          name,
          'psql',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-tAc',
          "SELECT count(*) FROM pg_locks WHERE relation='sample'::regclass AND mode='AccessExclusiveLock' AND granted"
        ])
        if (locked.stdout.trim() === '1') break
        if (attempt === 29)
          assert.fail('The cancellation fixture acquired its lock')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const active = new AbortController()
      const timer = setTimeout(() => active.abort(), 1000)
      try {
        await assert.rejects(
          sails.helpers.service.runExternalClient.with({
            serviceId: String(service.id),
            operation: 'dump',
            output: createWriteStream(path.join(root, 'cancelled.dmp')),
            maxBytes: 1024 * 1024,
            timeoutMs: 30000,
            signal: active.signal
          }),
          { code: 'STREAM_ABORTED' }
        )
      } finally {
        clearTimeout(timer)
        await command([
          'exec',
          name,
          'psql',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-c',
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='slipway-cancel-fixture'"
        ])
      }
      // Enable TLS with a disposable CA/server certificate for the real client handshake.
      const certConfig = path.join(root, 'certificate.conf')
      await fs.writeFile(
        certConfig,
        `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=Slipway fixture\n[ext]\nsubjectAltName=IP:${host}\nbasicConstraints=critical,CA:TRUE\n`
      )
      await run(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-keyout',
          path.join(root, 'server.key'),
          '-out',
          path.join(root, 'server.crt'),
          '-config',
          certConfig
        ],
        { timeout: 30000, maxBuffer: 8192 }
      )
      for (const file of ['server.key', 'server.crt'])
        await command(['cp', path.join(root, file), `${name}:/tmp/${file}`])
      await command([
        'exec',
        '--user',
        'root',
        name,
        'chown',
        'postgres:postgres',
        '/tmp/server.key',
        '/tmp/server.crt'
      ])
      await command([
        'exec',
        '--user',
        'root',
        name,
        'chmod',
        '600',
        '/tmp/server.key'
      ])
      for (const statement of [
        "ALTER SYSTEM SET ssl_cert_file='/tmp/server.crt'",
        "ALTER SYSTEM SET ssl_key_file='/tmp/server.key'",
        "ALTER SYSTEM SET ssl='on'",
        'SELECT pg_reload_conf()'
      ])
        await command([
          'exec',
          name,
          'psql',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-c',
          statement
        ])
      const caCertificate = await fs.readFile(
        path.join(root, 'server.crt'),
        'utf8'
      )
      await sails.models.service.updateOne({ id: service.id }).set({
        externalConnection: {
          ...config,
          sslMode: 'verify-full',
          caCertificate
        }
      })
      assert.equal(
        (await verify()).status,
        'reachable',
        'custom CA and hostname verification succeed'
      )
      await sails.models.service.updateOne({ id: service.id }).set({
        externalConnection: {
          ...config,
          sslMode: 'verify-full',
          caCertificate: ''
        }
      })
      assert.equal(
        (await verify()).code,
        'EXTERNAL_TLS',
        'untrusted certificate fails'
      )
      const leftover = (
        await command(['ps', '-aq', '--filter', 'name=slipway-pg-client-'])
      ).stdout.trim()
      assert.equal(
        leftover,
        '',
        'client containers are removed after failures and cancellation'
      )
    } finally {
      sails.config.custom.externalDatabaseClientNetwork = priorNetwork
      if (created) await command(['rm', '-f', name]).catch(() => {})
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)

// Storage transport has its own real SDK/emulator contract. Here the genuine
// external pg_dump must reach the shared manual/scheduled backup lifecycle.
async function verifyBackupLifecycle(sails, world, service, root) {
  const originalUpload = sails.helpers.backup.uploadObject
  const originalDelete = sails.helpers.backup.deleteBackupObject
  const objects = new Map()
  const upload = async ({ sourcePath, objectKey }) => {
    const bytes = await fs.readFile(sourcePath)
    assert.equal(bytes.subarray(0, 5).toString(), 'PGDMP')
    assert.equal((await fs.stat(sourcePath)).mode & 0o777, 0o600)
    objects.set(objectKey, bytes)
    return {
      checksum: require('node:crypto')
        .createHash('sha256')
        .update(bytes)
        .digest('hex')
    }
  }
  upload.with = upload
  const remove = async ({ objectKey }) => objects.delete(objectKey)
  remove.with = remove
  sails.helpers.backup.uploadObject = upload
  sails.helpers.backup.deleteBackupObject = remove
  try {
    await sails.helpers.setting.set(
      'backupStorageConfig',
      JSON.stringify({
        provider: 's3',
        bucket: 'private-fixture',
        region: 'us-east-1',
        accessKeyId: 'fixture',
        secretAccessKey: 'fixture'
      })
    )
    const pending = await world
      .create('backup')
      .with({ service: service.id, type: 'manual' })
    const manual = await sails.helpers.backup.runBackup(pending.id)
    assert.equal(manual.status, 'completed', manual.errorMessage)
    assert.ok(objects.has(manual.objectKey))
    await assert.rejects(
      sails.helpers.backup.restoreBackup(manual.id),
      /external|provider/i
    )
    await sails.helpers.setting.set(
      'backupSchedule',
      JSON.stringify({
        enabled: true,
        intervalHours: 24,
        retentionCount: 1,
        lastRunAt: 0
      })
    )
    await require('../../scripts/run-scheduled-backups').fn()
    const retained = await sails.models.backup.find({
      service: service.id,
      status: 'completed'
    })
    assert.equal(retained.length, 1)
    assert.equal(retained[0].type, 'scheduled')
    assert.equal(objects.has(manual.objectKey), false)
  } finally {
    sails.helpers.backup.uploadObject = originalUpload
    sails.helpers.backup.deleteBackupObject = originalDelete
    await sails.helpers.setting.set(
      'backupSchedule',
      JSON.stringify({ enabled: false })
    )
  }
}
