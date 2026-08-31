const { test } = require('sounding')
const uploadBearingUpdateImage = require('../../../api/controllers/project/upload-bearing-update-image')

test('Bearing update images use the manager app storage namespace', async ({
  sails,
  expect
}) => {
  const originalManager = sails.helpers.bearing.resolveManager
  const originalStorage = sails.helpers.uploads.getStorageConfig
  const originalUpload = sails.helpers.bearing.uploadFeedbackImages
  const originalFindSpace = sails.models.bearingspace.findOne
  const upstream = { upload() {} }
  let received

  sails.helpers.bearing.resolveManager = helper(async () => ({
    user: { id: 5, team: 7, teamRole: 'admin' },
    project: { id: 12, slug: 'northstar' },
    environment: { id: 13, slug: 'production' },
    app: { id: 14, slug: 'web' }
  }))
  sails.helpers.uploads.getStorageConfig = helper(async () => storage())
  sails.helpers.bearing.uploadFeedbackImages = helper(async (values) => {
    received = values
    return [
      {
        url: `https://assets.slipway.test/${values.directory}/update.png`,
        objectPath: `${values.directory}/update.png`,
        name: 'update.png',
        size: 1024,
        type: 'image/png'
      }
    ]
  })
  sails.models.bearingspace.findOne = async () => ({ id: 19, app: 14 })

  try {
    const result = await uploadBearingUpdateImage.fn.call(
      { req: { session: { userId: 5 } } },
      {
        slug: 'northstar',
        envSlug: 'production',
        appSlug: 'web',
        image: upstream
      }
    )

    expect(received.upstream).toBe(upstream)
    expect(received.directory).toBe(
      'bearing/teams/7/projects/12/apps/14/updates/assets'
    )
    expect(result).toEqual({
      imageUrl:
        'https://assets.slipway.test/bearing/teams/7/projects/12/apps/14/updates/assets/update.png'
    })
  } finally {
    sails.helpers.bearing.resolveManager = originalManager
    sails.helpers.uploads.getStorageConfig = originalStorage
    sails.helpers.bearing.uploadFeedbackImages = originalUpload
    sails.models.bearingspace.findOne = originalFindSpace
  }
})

test('Bearing update images turn provider failures into safe JSON', async ({
  sails,
  expect
}) => {
  const originalManager = sails.helpers.bearing.resolveManager
  const originalStorage = sails.helpers.uploads.getStorageConfig
  const originalUpload = sails.helpers.bearing.uploadFeedbackImages
  const originalFindSpace = sails.models.bearingspace.findOne

  sails.helpers.bearing.resolveManager = helper(async () => ({
    user: { id: 5, team: 7, teamRole: 'admin' },
    project: { id: 12, slug: 'northstar' },
    environment: { id: 13, slug: 'production' },
    app: { id: 14, slug: 'web' }
  }))
  sails.helpers.uploads.getStorageConfig = helper(async () => storage())
  sails.helpers.bearing.uploadFeedbackImages = helper(async () => {
    const error = new Error('The request signature we calculated did not match')
    error.code = 'SignatureDoesNotMatch'
    throw error
  })
  sails.models.bearingspace.findOne = async () => ({ id: 19, app: 14 })

  try {
    let receivedError
    try {
      await uploadBearingUpdateImage.fn.call(
        { req: { session: { userId: 5 } } },
        {
          slug: 'northstar',
          envSlug: 'production',
          appSlug: 'web',
          image: { upload() {} }
        }
      )
    } catch (error) {
      receivedError = error
    }

    expect(receivedError.badGateway.code).toBe('UPLOAD_STORAGE_PROVIDER_FAILED')
    expect(receivedError.badGateway.message).toContain(
      'secret key and endpoint'
    )
    expect(
      receivedError.badGateway.message.includes(
        'request signature we calculated'
      )
    ).toBe(false)
  } finally {
    sails.helpers.bearing.resolveManager = originalManager
    sails.helpers.uploads.getStorageConfig = originalStorage
    sails.helpers.bearing.uploadFeedbackImages = originalUpload
    sails.models.bearingspace.findOne = originalFindSpace
  }
})

function storage() {
  return {
    key: 'test-key',
    secret: 'test-secret',
    bucket: 'slipway',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    publicUrl: 'https://assets.slipway.test',
    region: 'auto'
  }
}

function helper(fn) {
  fn.with = fn
  return fn
}
