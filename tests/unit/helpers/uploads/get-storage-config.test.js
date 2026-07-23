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
      key: 'r2-key',
      secret: 'r2-secret',
      bucket: 'slipway-content',
      endpoint: 'https://objects.example.com',
      region: undefined,
      publicUrl: 'https://cdn.example.com'
    })
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
