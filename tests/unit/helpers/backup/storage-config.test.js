const { test } = require('sounding')
const assert = require('node:assert/strict')
const settings = require('../../../../api/lib/backup-storage-config')
const normalize = require('../../../../adapters/storage-error')
test('backup storage rejects unsafe configuration and never returns credentials in page props', async () => {
  for (const input of [
    null,
    {},
    { provider: 'unknown' },
    { provider: 's3', bucket: 'private', endpoint: 'http://example.com' },
    {
      provider: 'azure',
      bucket: 'private',
      account: 'validaccount',
      sasToken: 'sig=secret'
    }
  ])
    assert.throws(() => settings.resolve(input))
  const config = settings.resolve({
    provider: 's3',
    bucket: 'private-backups',
    region: 'us-east-1',
    key: 'access',
    secret: 'private'
  })
  assert.deepEqual(
    settings.resolve({ ...config, key: '', secret: '' }, config),
    config
  )
  assert.equal(
    JSON.stringify(settings.publicConfig(config)).includes('private"'),
    false
  )
  assert.equal(settings.publicConfig(config).hasCredentials, true)
  const error = normalize({
    code: 'AuthorizationPermissionMismatch',
    message: 'https://example.com?sig=do-not-leak'
  })
  assert.equal(error.code, 'STORAGE_AUTHORIZATION')
  assert.equal(normalize(error).code, error.code)
  assert.equal(error.message.includes('do-not-leak'), false)
})
test(
  'backup credentials stay encrypted and old backups retain their provider after a settings change',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'backup-storage-binding' } }
    }
  },
  async ({ sails, world }) => {
    const azure = {
      provider: 'azure',
      bucket: 'private-backups',
      account: 'testaccount',
      accountKey: 'private-account-key'
    }
    const s3 = {
      provider: 's3',
      bucket: 'original-backups',
      key: 'original-access',
      secret: 'original-secret'
    }
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'storage-db'
    })
    const backup = await world.create('backup').with({
      service: service.id,
      status: 'completed',
      s3Key: 'old/backup.dmp',
      objectKey: 'old/backup.dmp',
      storageCredentials: s3,
      storage: { provider: 's3', container: s3.bucket }
    })
    await sails.helpers.setting.set(
      'backupStorageConfig',
      JSON.stringify(azure)
    )
    assert.deepEqual(await sails.helpers.backup.getStorageConfig(backup.id), s3)
    assert.deepEqual(await sails.helpers.backup.getStorageConfig(), azure)
    const sealed = require('../../../../api/lib/sealed-backup-storage')
    const archived = sealed.seal(s3)
    assert.equal(JSON.stringify(archived).includes('original-secret'), false)
    assert.deepEqual(sealed.open(archived), s3)
    assert.throws(() =>
      sealed.open({ ...archived, tag: Buffer.alloc(16).toString('base64') })
    )
    const raw = await sails.models.backup.findOne({ id: backup.id })
    assert.equal(JSON.stringify(raw).includes('original-secret'), false)
    assert.equal(
      await sails.helpers.setting.get('backupStorageConfig'),
      JSON.stringify(azure)
    )
    assert.equal(
      JSON.stringify(
        (await sails.cache.get('setting:backupStorageConfig')) ?? null
      ).includes('private-account-key'),
      false
    )
    assert.equal(
      JSON.stringify(
        await sails.models.setting.findOne({ key: 'backupStorageConfig' })
      ).includes('private-account-key'),
      false
    )
  }
)

test(
  'backup privacy checks distinguish public access from provider failures without leaking response data',
  { world: { name: 'configured-slipway' } },
  async ({ sails }) => {
    const http = require('node:http')
    const verify = (configuration, adapter, objectKey, signal) =>
      sails.helpers.backup.verifyPrivateAccess.with({
        configuration,
        adapter,
        objectKey,
        signal
      })
    const denied = (overrides = {}) =>
      sails.helpers.backup.isAnonymousReadDenied.with({
        endpoint: 'https://test-account.r2.cloudflarestorage.com/bucket/key',
        status: 400,
        providerCode: 'InvalidArgument',
        authorizationRequired: true,
        ...overrides
      })
    assert.equal(denied(), true)
    for (const overrides of [
      { endpoint: 'https://s3.amazonaws.com/bucket/key' },
      {
        endpoint:
          'https://test-account.r2.cloudflarestorage.com.attacker.example/key'
      },
      { endpoint: 'https://uploads.example.com/key' },
      { endpoint: 'http://test-account.r2.cloudflarestorage.com/key' },
      { status: 429 },
      { status: 503 },
      { providerCode: 'InvalidBucketName' },
      { authorizationRequired: false }
    ])
      assert.equal(denied(overrides), false)
    const responses = new Map()
    const server = http.createServer((req, res) => {
      const fixture = responses.get(req.url) || { status: 403, body: '' }
      res.writeHead(fixture.status, { 'Content-Type': 'application/xml' })
      res.end(fixture.body)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const adapter = { anonymousUrl: () => `${base}/api` }
    try {
      for (const status of [401, 403, 404]) {
        responses.set('/api', { status, body: '' })
        await verify({}, adapter, 'backup.db', AbortSignal.timeout(2000))
      }
      for (const status of [400, 301, 429, 503]) {
        responses.set('/api', {
          status,
          body: '<Error><Code>InvalidArgument</Code><Message>secret-token</Message></Error>'
        })
        await assert.rejects(
          verify({}, adapter, 'backup.db', AbortSignal.timeout(2000)),
          (error) => {
            const sanitized = normalize(error)
            assert.equal(sanitized.code, 'STORAGE_PRIVACY_UNVERIFIED')
            assert.equal(sanitized.probeStatus, status)
            assert.equal(sanitized.probeRole, 'storage API')
            assert.match(sanitized.message, new RegExp(`HTTP ${status}`))
            assert.match(sanitized.message, /InvalidArgument/)
            assert.equal(sanitized.message.includes('secret-token'), false)
            assert.equal(sanitized.message.includes(base), false)
            assert.equal(normalize(sanitized).message, sanitized.message)
            return true
          }
        )
      }
      // A broken API probe must not hide a successful anonymous read through the CDN.
      responses.set('/backup.db', { status: 206, body: 'x' })
      await assert.rejects(
        verify(
          { publicUrl: base },
          adapter,
          'backup.db',
          AbortSignal.timeout(2000)
        ),
        { code: 'STORAGE_PUBLIC' }
      )
      responses.set('/backup.db', { status: 503, body: '' })
      responses.set('/api', { status: 200, body: 'x' })
      await assert.rejects(
        verify(
          { publicUrl: base },
          adapter,
          'backup.db',
          AbortSignal.timeout(2000)
        ),
        { code: 'STORAGE_PUBLIC' }
      )
      // Route the R2 URL to our real HTTP fixture so the complete response parser
      // and classification path run without credentials or a live cloud bucket.
      const originalFetch = global.fetch
      const r2Adapter = {
        anonymousUrl: () =>
          'https://test-account.r2.cloudflarestorage.com/bucket/key'
      }
      global.fetch = (url, options) =>
        originalFetch(
          new URL(url).hostname === 'test-account.r2.cloudflarestorage.com'
            ? `${base}/api`
            : url,
          options
        )
      try {
        responses.set('/api', {
          status: 400,
          body: '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>'
        })
        await verify({}, r2Adapter, 'backup.db', AbortSignal.timeout(2000))
        responses.set('/backup.db', { status: 206, body: 'x' })
        await assert.rejects(
          verify(
            { publicUrl: base },
            r2Adapter,
            'backup.db',
            AbortSignal.timeout(2000)
          ),
          { code: 'STORAGE_PUBLIC' }
        )
        responses.set('/api', {
          status: 400,
          body: '<Error><Code>InvalidArgument</Code><Message>Different problem</Message></Error>'
        })
        await assert.rejects(
          verify({}, r2Adapter, 'backup.db', AbortSignal.timeout(2000)),
          { code: 'STORAGE_PRIVACY_UNVERIFIED' }
        )
      } finally {
        global.fetch = originalFetch
      }
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
)
