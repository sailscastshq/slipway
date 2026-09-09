const { test } = require('sounding')
const assert = require('node:assert/strict')
const settings = require('../../../../api/lib/backup-storage-config')
const normalize = require('../../../../api/lib/object-storage/errors')
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
