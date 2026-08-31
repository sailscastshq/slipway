const { test } = require('sounding')

test('upload storage config resolves the shared provider settings', async ({
  sails,
  expect
}) => {
  const originalSettingGet = sails.helpers.setting.get
  const originalUploads = sails.config.uploads
  sails.helpers.setting.get = async () =>
    JSON.stringify({
      R2_ACCESS_KEY: 'r2-key',
      R2_SECRET_KEY: 'r2-secret',
      R2_BUCKET: 'slipway-content',
      R2_ENDPOINT: 'https://objects.example.com',
      R2_PUBLIC_URL: 'https://cdn.example.com'
    })
  sails.config.uploads = {}

  try {
    const config = await sails.helpers.uploads.getStorageConfig()

    expect(config).toEqual({
      provider: 'r2',
      key: 'r2-key',
      secret: 'r2-secret',
      bucket: 'slipway-content',
      endpoint: 'https://objects.example.com',
      region: 'auto',
      publicUrl: 'https://cdn.example.com'
    })
  } finally {
    sails.helpers.setting.get = originalSettingGet
    sails.config.uploads = originalUploads
  }
})

test('public upload config rejects backup-only R2 settings', async ({
  sails,
  expect
}) => {
  const originalSettingGet = sails.helpers.setting.get
  const originalUploads = sails.config.uploads
  sails.helpers.setting.get = async () =>
    JSON.stringify({
      R2_ACCESS_KEY: 'r2-key',
      R2_SECRET_KEY: 'r2-secret',
      R2_BUCKET: 'slipway-content',
      R2_ENDPOINT: 'https://objects.example.com'
    })
  sails.config.uploads = {}

  try {
    let receivedError
    try {
      await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
    } catch (error) {
      receivedError = error
    }

    expect(receivedError.code).toBe('PUBLIC_UPLOAD_STORAGE_NOT_CONFIGURED')
    expect(receivedError.message).toContain('public URL')
  } finally {
    sails.helpers.setting.get = originalSettingGet
    sails.config.uploads = originalUploads
  }
})

test('upload storage never combines partial provider settings', async ({
  sails,
  expect
}) => {
  const originalSettingGet = sails.helpers.setting.get
  const originalUploads = sails.config.uploads
  sails.helpers.setting.get = async () =>
    JSON.stringify({
      R2_ACCESS_KEY: 'partial-r2-key',
      R2_BUCKET: 'partial-r2-bucket',
      S3_ACCESS_KEY: 's3-key',
      S3_SECRET_KEY: 's3-secret',
      S3_BUCKET: 's3-bucket',
      S3_REGION: 'eu-west-1',
      S3_PUBLIC_URL: 'https://assets.example.com'
    })
  sails.config.uploads = {}

  try {
    const config = await sails.helpers.uploads.getStorageConfig.with({
      requirePublicUrl: true
    })

    expect(config.provider).toBe('s3')
    expect(config.key).toBe('s3-key')
    expect(config.secret).toBe('s3-secret')
    expect(config.bucket).toBe('s3-bucket')
  } finally {
    sails.helpers.setting.get = originalSettingGet
    sails.config.uploads = originalUploads
  }
})

test('upload storage config reports when no provider is configured', async ({
  sails,
  expect
}) => {
  const originalSettingGet = sails.helpers.setting.get
  const originalUploads = sails.config.uploads
  sails.helpers.setting.get = async () => '{}'
  sails.config.uploads = {}

  try {
    let receivedError
    try {
      await sails.helpers.uploads.getStorageConfig()
    } catch (error) {
      receivedError = error
    }

    expect(receivedError.code).toBe('UPLOAD_STORAGE_NOT_CONFIGURED')
  } finally {
    sails.helpers.setting.get = originalSettingGet
    sails.config.uploads = originalUploads
  }
})
