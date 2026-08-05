const { test } = require('sounding')

const context = {
  actorId: 15,
  projectId: 12,
  environmentId: 13,
  appId: 14,
  resource: 'lesson',
  field: 'videoUrl'
}

const upload = {
  strategy: 'multipart',
  url: 'https://assets.sailscasts.test/courses/durable-ui/video.mp4',
  objectPath: 'courses/durable-ui/video.mp4',
  fileSize: 93 * 1024 * 1024,
  fileType: 'video/mp4',
  recordId: '42',
  uploadId: 'opaque-r2-upload-id',
  partSize: 16 * 1024 * 1024,
  partCount: 6
}

test('Bridge direct upload intents bind the exact actor, app, file, and multipart session', async ({
  sails,
  expect
}) => {
  const intent = await sails.helpers.bridge.createDirectUploadIntent.with({
    context,
    upload
  })
  const payload = await sails.helpers.bridge.verifyDirectUploadIntent.with({
    intent,
    context
  })

  for (const [key, value] of Object.entries(context)) {
    expect(payload[key]).toBe(String(value))
  }
  expect(payload.strategy).toBe('multipart')
  expect(payload.objectPath).toBe(upload.objectPath)
  expect(payload.fileSize).toBe(upload.fileSize)
  expect(payload.fileType).toBe(upload.fileType)
  expect(payload.recordId).toBe(upload.recordId)
  expect(payload.uploadId).toBe(upload.uploadId)
  expect(payload.partSize).toBe(upload.partSize)
  expect(payload.partCount).toBe(upload.partCount)

  const replayed = await sails.helpers.bridge.verifyDirectUploadIntent.with({
    intent,
    context
  })
  expect(replayed.objectPath).toBe(payload.objectPath)
})

test('Bridge direct upload intents cannot cross actors or apps', async ({
  sails,
  expect
}) => {
  const intent = await sails.helpers.bridge.createDirectUploadIntent.with({
    context,
    upload
  })

  let actorError
  try {
    await sails.helpers.bridge.verifyDirectUploadIntent.with({
      intent,
      context: { ...context, actorId: 99 }
    })
  } catch (error) {
    actorError = error
  }
  expect(actorError.code).toBe('BRIDGE_DIRECT_UPLOAD_INTENT_INVALID')

  let appError
  try {
    await sails.helpers.bridge.verifyDirectUploadIntent.with({
      intent,
      context: { ...context, appId: 88 }
    })
  } catch (error) {
    appError = error
  }
  expect(appError.code).toBe('BRIDGE_DIRECT_UPLOAD_INTENT_INVALID')
})

test('Bridge rejects tampered direct upload intents', async ({
  sails,
  expect
}) => {
  const intent = await sails.helpers.bridge.createDirectUploadIntent.with({
    context,
    upload
  })
  const [encoded, signature] = intent.split('.')
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString())
  payload.fileSize += 1
  const tampered = `${Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  )}.${signature}`

  let receivedError
  try {
    await sails.helpers.bridge.verifyDirectUploadIntent.with({
      intent: tampered,
      context
    })
  } catch (error) {
    receivedError = error
  }
  expect(receivedError.code).toBe('BRIDGE_DIRECT_UPLOAD_INTENT_INVALID')
})

test('Bridge rejects expired direct upload intents', async ({
  sails,
  expect
}) => {
  const originalNow = Date.now
  const issuedAt = originalNow()
  Date.now = () => issuedAt
  let intent
  try {
    intent = await sails.helpers.bridge.createDirectUploadIntent.with({
      context,
      upload,
      expiresInMs: 60 * 1000
    })
    Date.now = () => issuedAt + 60 * 1000
    let receivedError
    try {
      await sails.helpers.bridge.verifyDirectUploadIntent.with({
        intent,
        context
      })
    } catch (error) {
      receivedError = error
    }
    expect(receivedError.code).toBe('BRIDGE_DIRECT_UPLOAD_INTENT_INVALID')
  } finally {
    Date.now = originalNow
  }
})
