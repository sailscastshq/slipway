const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const { Readable, Writable } = require('node:stream')
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  ContainerSASPermissions
} = require('@azure/storage-blob')
const createStorage = require('../../api/lib/object-storage')
const settings = require('../../api/lib/backup-storage-config')
const createS3 = require('../../api/lib/s3-client')
const dependencyRoot = process.env.SLIPWAY_STORAGE_EMULATORS
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
async function contract(config) {
  const storage = createStorage(config)
  assert.equal((await storage.testConnection()).verified, true)
  const objectKey = `contract/${randomUUID()}`
  const data = randomBytes(6 * 1024 * 1024 + 321)
  const uploaded = await storage.putObject({
    objectKey,
    input: Readable.from([data]),
    maxBytes: data.length
  })
  assert.equal(uploaded.bytes, data.length)
  let received = []
  await storage.getObject({
    objectKey,
    output: new Writable({
      write(chunk, encoding, next) {
        received.push(chunk)
        next()
      }
    }),
    maxBytes: data.length,
    checksum: uploaded.checksum
  })
  assert.deepEqual(Buffer.concat(received), data)
  await assert.rejects(
    storage.getObject({
      objectKey,
      output: new Writable({
        write(chunk, encoding, next) {
          next()
        }
      }),
      maxBytes: data.length,
      checksum: 'wrong'
    }),
    { code: 'STORAGE_INTEGRITY' }
  )
  await assert.rejects(
    storage.putObject({
      objectKey,
      input: Readable.from(['replacement']),
      maxBytes: 100
    })
  )
  received = []
  await storage.getObject({
    objectKey,
    output: new Writable({
      write(chunk, encoding, next) {
        received.push(chunk)
        next()
      }
    }),
    maxBytes: data.length,
    checksum: uploaded.checksum
  })
  assert.deepEqual(
    Buffer.concat(received),
    data,
    'failed collision must preserve the existing backup'
  )
  await storage.deleteObject({ objectKey })
  const oversized = `contract/${randomUUID()}`
  await assert.rejects(
    storage.putObject({
      objectKey: oversized,
      input: Readable.from([randomBytes(2048)]),
      maxBytes: 1024
    }),
    { code: 'STREAM_SIZE_LIMIT' }
  )
  await assert.rejects(
    storage.getObject({
      objectKey: oversized,
      output: new Writable({
        write(c, e, n) {
          n()
        }
      }),
      maxBytes: 4096
    })
  )
  const controller = new AbortController()
  const slow = new Readable({ read() {} })
  const timer = setTimeout(() => controller.abort(), 200)
  await assert.rejects(
    storage.putObject({
      objectKey: `contract/${randomUUID()}`,
      input: slow,
      maxBytes: 4096,
      signal: controller.signal
    }),
    { code: 'STREAM_ABORTED' }
  )
  clearTimeout(timer)
  assert.equal(slow.destroyed, true)
  await assert.rejects(
    storage.putObject({
      objectKey: `contract/${randomUUID()}`,
      input: new Readable({ read() {} }),
      maxBytes: 4096,
      timeoutMs: 100
    }),
    { code: 'STREAM_TIMEOUT' }
  )
}
test(
  'private S3 and Azure adapters preserve content and clean up rejected transfers',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'azure-backup-contract' } }
    }
  },
  async ({ sails, world, request }) => {
    assert.ok(
      dependencyRoot,
      'Set SLIPWAY_STORAGE_EMULATORS to the pinned emulator node_modules directory'
    )
    const S3rver = require(path.join(dependencyRoot, 's3rver'))
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'slipway-storage-contract-')
    )
    let azureProcess, s3, s3Client
    const account = 'slipwaytest'
    const key = randomBytes(64).toString('base64')
    try {
      let publicReads = false
      s3 = new S3rver({
        address: '127.0.0.1',
        port: 0,
        silent: true,
        directory: path.join(root, 's3'),
        configureBuckets: [{ name: 'private-backups' }]
      })
      // S3rver intentionally permits anonymous requests; this fixture adds a private-bucket boundary.
      // AWS/R2 policy behavior still requires the documented real-provider smoke check.
      s3.middleware.unshift(async (ctx, next) => {
        if (!publicReads && !ctx.get('authorization')) {
          ctx.status = 403
          return
        }
        // S3rver also omits conditional PUT support. Enforce the request's create-only condition.
        if (ctx.method === 'PUT' && ctx.get('if-none-match') === '*') {
          const [, bucket, ...segments] = ctx.path.split('/')
          const existing = await s3.store.getObject(
            bucket,
            decodeURIComponent(segments.join('/'))
          )
          if (existing) {
            existing.content?.destroy()
            ctx.status = 412
            return
          }
        }
        await next()
      })
      const address = await s3.run()
      const s3Config = {
        provider: 's3',
        bucket: 'private-backups',
        endpoint: `http://127.0.0.1:${address.port}`,
        key: 'S3RVER',
        secret: 'S3RVER',
        region: 'us-east-1'
      }
      s3Client = createS3(s3Config)
      await contract(s3Config)
      publicReads = true
      await assert.rejects(createStorage(s3Config).testConnection(), {
        code: 'STORAGE_PUBLIC'
      })
      publicReads = false
      await assert.rejects(
        createStorage({
          ...s3Config,
          key: 'wrong',
          secret: 'wrong'
        }).testConnection()
      )
      const port = await freePort()
      const endpoint = `http://127.0.0.1:${port}/${account}`
      azureProcess = spawn(
        process.execPath,
        [
          path.join(dependencyRoot, 'azurite/dist/src/blob/main.js'),
          '--blobHost',
          '127.0.0.1',
          '--blobPort',
          String(port),
          '--location',
          path.join(root, 'azure'),
          '--silent',
          '--skipApiVersionCheck'
        ],
        {
          env: { ...process.env, AZURITE_ACCOUNTS: `${account}:${key}` },
          stdio: 'ignore'
        }
      )
      const client = new BlobServiceClient(
        endpoint,
        new StorageSharedKeyCredential(account, key)
      )
      const container = client.getContainerClient('private-backups')
      let ready = false
      for (let i = 0; i < 50; i++) {
        try {
          await container.create()
          ready = true
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
      assert.ok(ready, 'Azurite starts')
      const azureConfig = {
        provider: 'azure',
        bucket: 'private-backups',
        account,
        accountKey: key,
        endpoint
      }
      await contract(azureConfig)
      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: 'private-backups',
          permissions: ContainerSASPermissions.parse('rwd'),
          expiresOn: new Date(Date.now() + 3600000)
        },
        new StorageSharedKeyCredential(account, key)
      ).toString()
      const sasConfig = settings.resolve({
        ...azureConfig,
        authMethod: 'sas',
        sasToken,
        allowInsecure: true
      })
      await contract(sasConfig)
      await assert.rejects(
        createStorage({
          ...azureConfig,
          accountKey: randomBytes(64).toString('base64')
        }).testConnection()
      )
      await backupLifecycle(azureConfig, sails, world, root, request)
      await container.setAccessPolicy('blob')
      await assert.rejects(createStorage(azureConfig).testConnection(), {
        code: 'STORAGE_PUBLIC'
      })
      let remaining = []
      for await (const blob of container.listBlobsFlat())
        remaining.push(blob.name)
      assert.deepEqual(
        remaining,
        [],
        'all test and cancelled objects were removed'
      )
      const objects = await s3Client.listObjectsV2({
        Bucket: 'private-backups'
      })
      assert.equal(objects.KeyCount || 0, 0)
    } finally {
      s3Client?.destroy()
      await s3?.close()
      if (azureProcess && azureProcess.exitCode === null) {
        const stopped = new Promise((resolve) =>
          azureProcess.once('exit', resolve)
        )
        azureProcess.kill('SIGTERM')
        await stopped
      }
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)

async function backupLifecycle(config, sails, world, root, request) {
  const service = await world.create('service').with({
    environment: world.current.environments.production.id,
    name: 'azure-db',
    status: 'running',
    containerName: 'fixture-database',
    database: 'fixture',
    username: 'postgres',
    password: 'fixture-secret'
  })
  const originalProcess = sails.helpers.streams.runProcess
  const originalNotification = sails.helpers.notification.sendBackupNotification
  const fixture = Buffer.from('PGDMPtransport-fixture')
  const dump = async ({ output }) =>
    new Promise((resolve, reject) => {
      output.once('error', reject)
      output.end(fixture, resolve)
    })
  dump.with = dump
  sails.helpers.streams.runProcess = dump
  const notification = () => {}
  notification.with = () => ({ tolerate: async () => {} })
  sails.helpers.notification.sendBackupNotification = notification
  try {
    await sails.helpers.setting.set(
      'backupStorageConfig',
      JSON.stringify(config)
    )
    const pending = await world.create('backup').with({ service: service.id })
    const manual = await sails.helpers.backup.runBackup(pending.id)
    assert.equal(manual.status, 'completed', manual.errorMessage)
    assert.equal(manual.s3Key, null)
    assert.equal(manual.storage.provider, 'azure')
    assert.equal(manual.sizeBytes, fixture.length)
    const { withCsrfFromPage } = require('../support/csrf-request')
    const browser = await withCsrfFromPage(request, '/', 'genesisUser')
    await sails.models.backup
      .updateOne({ id: manual.id })
      .set({ storageCredentials: { ...config, accountKey: 'expired-key' } })
    const saved = await browser.request.post('/settings/backup-storage', {
      configuration: {
        ...config,
        authMethod: 'account-key',
        allowInsecure: true
      }
    })
    assert.equal(
      saved.statusCode || saved.status,
      200,
      JSON.stringify(saved.data)
    )
    assert.equal(JSON.stringify(saved.data).includes(config.accountKey), false)
    assert.equal(
      (await sails.helpers.backup.getStorageConfig(manual.id)).accountKey,
      config.accountKey
    )
    const destinationPath = path.join(root, 'downloaded.dmp')
    await sails.helpers.backup.downloadObject.with({
      objectKey: manual.objectKey,
      destinationPath,
      storageConfig: await sails.helpers.backup.getStorageConfig(manual.id),
      maxBytes: 1024,
      timeoutMs: 10000,
      checksum: manual.storage.checksum
    })
    assert.deepEqual(await fs.readFile(destinationPath), fixture)
    assert.equal((await fs.stat(destinationPath)).mode & 0o777, 0o600)
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
    assert.equal(
      await sails.models.backup.findOne({ id: manual.id }),
      undefined
    )
    const retained = await sails.models.backup.find({
      service: service.id,
      status: 'completed'
    })
    assert.equal(retained.length, 1)
    assert.equal(retained[0].type, 'scheduled')
    await sails.helpers.backup.deleteBackupObject.with({
      objectKey: retained[0].objectKey,
      backupId: retained[0].id
    })
    await sails.models.backup.destroy({ service: service.id })
  } finally {
    sails.helpers.streams.runProcess = originalProcess
    sails.helpers.notification.sendBackupNotification = originalNotification
  }
}
