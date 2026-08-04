const { test } = require('sounding')
const prepareUpload = require('../../../api/controllers/project/bridge-prepare-upload-field')
const completeUpload = require('../../../api/controllers/project/bridge-complete-upload-field')

test('Bridge prepares a direct upload with a collision-safe key', async ({
  sails,
  expect
}) => {
  const originals = {
    prepareUploadTarget: sails.helpers.bridge.prepareUploadTarget,
    createDirectUploadUrl: sails.helpers.bridge.createDirectUploadUrl,
    createUploadReceipt: sails.helpers.bridge.createUploadReceipt
  }
  let signedObjectPath
  let receiptInput

  sails.helpers.bridge.prepareUploadTarget = helper(async () => ({
    project: { id: 12 },
    environment: { id: 13 },
    app: { id: 14 },
    actorId: 15,
    loaded: { resource: { identity: 'lesson' } },
    attribute: { label: 'Video' },
    upload: {
      accept: ['video/mp4'],
      maxBytes: 2 * 1024 * 1024 * 1024
    },
    storage: {
      publicUrl: 'https://assets.sailscasts.test'
    },
    surface: 'create',
    directory: 'courses/durable-ui/welcome',
    configuredFilename: 'state-placement'
  }))
  sails.helpers.bridge.createDirectUploadUrl = helper(
    async ({ objectPath }) => {
      signedObjectPath = objectPath
      return `https://r2.example.test/presigned/${objectPath}`
    }
  )
  sails.helpers.bridge.createUploadReceipt = helper(async (input) => {
    receiptInput = input
    return 'signed-upload-receipt'
  })

  try {
    const result = await prepareUpload.fn.call(
      { req: {} },
      {
        slug: 'sailscasts',
        envSlug: 'production',
        appSlug: 'web',
        modelIdentity: 'lesson',
        fieldName: 'videoUrl',
        values: { course: 'course-1', chapter: 'chapter-1' },
        fileName: 'recording.exe',
        fileType: 'video/mp4',
        fileSize: 4096
      }
    )

    expect(signedObjectPath).toMatch(
      /^courses\/durable-ui\/welcome\/state-placement-[0-9a-f-]{36}\.mp4$/
    )
    expect(receiptInput.url).toBe(
      `https://assets.sailscasts.test/${signedObjectPath}`
    )
    expect(result).toEqual({
      method: 'PUT',
      uploadUrl: `https://r2.example.test/presigned/${signedObjectPath}`,
      headers: { 'Content-Type': 'video/mp4' },
      url: `https://assets.sailscasts.test/${signedObjectPath}`,
      uploadReceipt: 'signed-upload-receipt',
      expiresInSeconds: 900
    })
  } finally {
    sails.helpers.bridge.prepareUploadTarget = originals.prepareUploadTarget
    sails.helpers.bridge.createDirectUploadUrl = originals.createDirectUploadUrl
    sails.helpers.bridge.createUploadReceipt = originals.createUploadReceipt
  }
})

test('Bridge completes a direct upload only after object metadata is verified', async ({
  sails,
  expect
}) => {
  const originals = {
    resolveRequest: sails.helpers.bridge.resolveRequest,
    verifyUploadReceipt: sails.helpers.bridge.verifyUploadReceipt,
    loadResource: sails.helpers.bridge.loadResource,
    getUploadStorageConfig: sails.helpers.bridge.getUploadStorageConfig,
    verifyDirectUploadObject: sails.helpers.bridge.verifyDirectUploadObject,
    createUploadReceipt: sails.helpers.bridge.createUploadReceipt
  }
  let verifiedInput

  sails.helpers.bridge.resolveRequest = helper(async () => ({
    project: { id: 12 },
    environment: { id: 13 },
    app: { id: 14, containerName: 'sailscasts-web' },
    actor: { id: 15 },
    actorId: 15
  }))
  sails.helpers.bridge.verifyUploadReceipt = helper(async ({ url }) => url)
  sails.helpers.bridge.loadResource = helper(async () => ({
    resource: {
      identity: 'lesson',
      create: ['videoUrl'],
      edit: ['videoUrl'],
      attributes: {
        videoUrl: {
          field: { type: 'upload', upload: { storage: 'bridge' } }
        }
      }
    }
  }))
  sails.helpers.bridge.getUploadStorageConfig = helper(async () => ({
    publicUrl: 'https://assets.sailscasts.test',
    bucket: 'course-videos'
  }))
  sails.helpers.bridge.verifyDirectUploadObject = helper(async (input) => {
    verifiedInput = input
    return { size: 4096, type: 'video/mp4', etag: 'verified-etag' }
  })
  sails.helpers.bridge.createUploadReceipt = helper(
    async () => 'verified-upload-receipt'
  )

  try {
    const result = await completeUpload.fn.call(
      { req: {} },
      {
        slug: 'sailscasts',
        envSlug: 'production',
        appSlug: 'web',
        modelIdentity: 'lesson',
        fieldName: 'videoUrl',
        url: 'https://assets.sailscasts.test/courses/durable-ui/welcome/state-placement-11111111-1111-4111-8111-111111111111.mp4',
        uploadReceipt: 'signed-upload-receipt'
      }
    )

    expect(verifiedInput.objectPath).toContain(
      'courses/durable-ui/welcome/state-placement-'
    )
    expect(result.receipt).toBe('verified-upload-receipt')
    expect(result.file.etag).toBe('verified-etag')
  } finally {
    sails.helpers.bridge.resolveRequest = originals.resolveRequest
    sails.helpers.bridge.verifyUploadReceipt = originals.verifyUploadReceipt
    sails.helpers.bridge.loadResource = originals.loadResource
    sails.helpers.bridge.getUploadStorageConfig =
      originals.getUploadStorageConfig
    sails.helpers.bridge.verifyDirectUploadObject =
      originals.verifyDirectUploadObject
    sails.helpers.bridge.createUploadReceipt = originals.createUploadReceipt
  }
})

function helper(fn) {
  fn.with = fn
  return fn
}
