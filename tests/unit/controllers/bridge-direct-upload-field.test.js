const { test } = require('sounding')
const prepareUpload = require('../../../api/controllers/project/bridge-prepare-upload-field')
const resumeUpload = require('../../../api/controllers/project/bridge-resume-upload-field')
const completeUpload = require('../../../api/controllers/project/bridge-complete-upload-field')
const abortUpload = require('../../../api/controllers/project/bridge-abort-upload-field')

const MIB = 1024 * 1024

test('Bridge prepares a small direct PUT with a collision-safe key', async ({
  sails,
  expect
}) => {
  const restore = stubPrepareHelpers(sails)
  let signedObjectPath
  let intentInput
  sails.helpers.bridge.directUploadStorage = helper(async (input) => {
    expect(input.operation).toBe('signPut')
    signedObjectPath = input.objectPath
    return { uploadUrl: 'https://r2.example.test/put', expiresInSeconds: 3600 }
  })
  sails.helpers.bridge.createDirectUploadIntent = helper(async (input) => {
    intentInput = input
    return 'signed-upload-intent'
  })

  try {
    const result = await prepareUpload.fn.call(
      { req: {} },
      uploadInputs({ fileSize: 4 * MIB })
    )
    expect(signedObjectPath).toMatch(
      /^courses\/durable-ui\/welcome\/state-placement-[0-9a-f-]{36}\.mp4$/
    )
    expect(intentInput.upload.strategy).toBe('single')
    expect(result.strategy).toBe('single')
    expect(result.method).toBe('PUT')
    expect(result.uploadUrl).toBe('https://r2.example.test/put')
    expect(result.uploadIntent).toBe('signed-upload-intent')
    expect(result.headers).toEqual({ 'Content-Type': 'video/mp4' })
  } finally {
    restore()
  }
})

test('Bridge prepares a 93 MiB video as six resumable multipart parts', async ({
  sails,
  expect
}) => {
  const restore = stubPrepareHelpers(sails)
  const operations = []
  let intentInput
  sails.helpers.bridge.directUploadStorage = helper(async (input) => {
    operations.push(input)
    if (input.operation === 'createMultipart') {
      return { uploadId: 'r2-upload-id' }
    }
    return {
      parts: input.partNumbers.map((partNumber) => ({
        partNumber,
        uploadUrl: `https://r2.example.test/part/${partNumber}`
      })),
      expiresInSeconds: 3600
    }
  })
  sails.helpers.bridge.createDirectUploadIntent = helper(async (input) => {
    intentInput = input
    return 'signed-multipart-intent'
  })

  try {
    const result = await prepareUpload.fn.call(
      { req: {} },
      uploadInputs({ fileSize: 93 * MIB })
    )
    expect(operations.map(({ operation }) => operation)).toEqual([
      'createMultipart',
      'signParts'
    ])
    expect(result.strategy).toBe('multipart')
    expect(result.partSize).toBe(16 * MIB)
    expect(result.partCount).toBe(6)
    expect(result.parts.map(({ partNumber }) => partNumber)).toEqual([
      1, 2, 3, 4, 5, 6
    ])
    expect(intentInput.upload.strategy).toBe('multipart')
    expect(intentInput.upload.uploadId).toBe('r2-upload-id')
    expect(intentInput.upload.fileSize).toBe(93 * MIB)
    expect(intentInput.upload.partSize).toBe(16 * MIB)
    expect(intentInput.upload.partCount).toBe(6)
  } finally {
    restore()
  }
})

test('Bridge resumes from authoritative stored parts and signs only missing parts', async ({
  sails,
  expect
}) => {
  const originalSession = sails.helpers.bridge.resolveDirectUploadSession
  const originalStorage = sails.helpers.bridge.directUploadStorage
  const signed = []
  sails.helpers.bridge.resolveDirectUploadSession = helper(async () => ({
    payload: multipartPayload({ fileSize: 93 * MIB, partCount: 6 }),
    storage: { bucket: 'course-videos' }
  }))
  sails.helpers.bridge.directUploadStorage = helper(async (input) => {
    if (input.operation === 'listParts') {
      return {
        parts: [
          { partNumber: 1, size: 16 * MIB, etag: 'one' },
          { partNumber: 2, size: 16 * MIB, etag: 'two' }
        ]
      }
    }
    signed.push(...input.partNumbers)
    return {
      parts: input.partNumbers.map((partNumber) => ({
        partNumber,
        uploadUrl: `https://r2.example.test/part/${partNumber}`
      })),
      expiresInSeconds: 3600
    }
  })

  try {
    const result = await resumeUpload.fn.call({ req: {} }, sessionInputs())
    expect(signed).toEqual([3, 4, 5, 6])
    expect(result.uploadedParts.length).toBe(2)
    expect(result.parts.length).toBe(4)
  } finally {
    sails.helpers.bridge.resolveDirectUploadSession = originalSession
    sails.helpers.bridge.directUploadStorage = originalStorage
  }
})

test('Bridge replaces malformed stored parts instead of trusting their progress', async ({
  sails,
  expect
}) => {
  const originalSession = sails.helpers.bridge.resolveDirectUploadSession
  const originalStorage = sails.helpers.bridge.directUploadStorage
  let signed
  sails.helpers.bridge.resolveDirectUploadSession = helper(async () => ({
    payload: multipartPayload({ fileSize: 33 * MIB, partCount: 3 }),
    storage: { bucket: 'course-videos' }
  }))
  sails.helpers.bridge.directUploadStorage = helper(async (input) => {
    if (input.operation === 'listParts') {
      return {
        parts: [
          { partNumber: 1, size: 16 * MIB, etag: 'one' },
          { partNumber: 2, size: 2 * MIB, etag: 'truncated' },
          { partNumber: 3, size: 1 * MIB, etag: 'three' }
        ]
      }
    }
    signed = input.partNumbers
    return {
      parts: input.partNumbers.map((partNumber) => ({
        partNumber,
        uploadUrl: `https://r2.example.test/part/${partNumber}`
      })),
      expiresInSeconds: 3600
    }
  })

  try {
    const result = await resumeUpload.fn.call({ req: {} }, sessionInputs())
    expect(signed).toEqual([2])
    expect(result.uploadedParts.map(({ partNumber }) => partNumber)).toEqual([
      1, 3
    ])
  } finally {
    sails.helpers.bridge.resolveDirectUploadSession = originalSession
    sails.helpers.bridge.directUploadStorage = originalStorage
  }
})

test('Bridge recovers when multipart completion succeeded but its response was lost', async ({
  sails,
  expect
}) => {
  const originalSession = sails.helpers.bridge.resolveDirectUploadSession
  const originalStorage = sails.helpers.bridge.directUploadStorage
  const operations = []
  sails.helpers.bridge.resolveDirectUploadSession = helper(async () => ({
    payload: multipartPayload({ fileSize: 93 * MIB, partCount: 6 }),
    storage: { bucket: 'course-videos' }
  }))
  sails.helpers.bridge.directUploadStorage = helper(async (input) => {
    operations.push(input.operation)
    if (input.operation === 'listParts') {
      const error = new Error('gone')
      error.code = 'BRIDGE_MULTIPART_UPLOAD_MISSING'
      throw error
    }
    return { size: 93 * MIB, type: 'video/mp4', etag: 'complete' }
  })

  try {
    const result = await resumeUpload.fn.call({ req: {} }, sessionInputs())
    expect(operations).toEqual(['listParts', 'head'])
    expect(result.strategy).toBe('multipart')
    expect(result.completed).toBe(true)
    expect(result.parts).toEqual([])
  } finally {
    sails.helpers.bridge.resolveDirectUploadSession = originalSession
    sails.helpers.bridge.directUploadStorage = originalStorage
  }
})

test('Bridge completes server-listed parts and verifies exact object metadata', async ({
  sails,
  expect
}) => {
  const originals = {
    session: sails.helpers.bridge.resolveDirectUploadSession,
    storage: sails.helpers.bridge.directUploadStorage,
    receipt: sails.helpers.bridge.createUploadReceipt
  }
  const payload = multipartPayload({ fileSize: 33 * MIB, partCount: 3 })
  const parts = [
    { partNumber: 1, size: 16 * MIB, etag: 'one' },
    { partNumber: 2, size: 16 * MIB, etag: 'two' },
    { partNumber: 3, size: 1 * MIB, etag: 'three' }
  ]
  const operations = []
  sails.helpers.bridge.resolveDirectUploadSession = helper(async () => ({
    payload,
    storage: { bucket: 'course-videos' },
    actorId: 15,
    project: { id: 12 },
    environment: { id: 13 },
    loaded: { resource: { identity: 'lesson' } }
  }))
  sails.helpers.bridge.directUploadStorage = helper(async (input) => {
    operations.push(input.operation)
    if (input.operation === 'listParts') return { parts }
    if (input.operation === 'completeMultipart') return { etag: 'complete' }
    return { size: 33 * MIB, type: 'video/mp4', etag: 'verified' }
  })
  sails.helpers.bridge.createUploadReceipt = helper(
    async () => 'verified-upload-receipt'
  )

  try {
    const result = await completeUpload.fn.call({ req: {} }, sessionInputs())
    expect(operations).toEqual(['listParts', 'completeMultipart', 'head'])
    expect(result.receipt).toBe('verified-upload-receipt')
    expect(result.file.size).toBe(33 * MIB)
    expect(result.file.type).toBe('video/mp4')
    expect(result.file.etag).toBe('verified')
  } finally {
    sails.helpers.bridge.resolveDirectUploadSession = originals.session
    sails.helpers.bridge.directUploadStorage = originals.storage
    sails.helpers.bridge.createUploadReceipt = originals.receipt
  }
})

test('Bridge explicitly aborts multipart state after cancellation', async ({
  sails,
  expect
}) => {
  const originalSession = sails.helpers.bridge.resolveDirectUploadSession
  const originalStorage = sails.helpers.bridge.directUploadStorage
  let operation
  sails.helpers.bridge.resolveDirectUploadSession = helper(async () => ({
    payload: multipartPayload({ fileSize: 93 * MIB, partCount: 6 }),
    storage: { bucket: 'course-videos' }
  }))
  sails.helpers.bridge.directUploadStorage = helper(async (input) => {
    operation = input.operation
    return { aborted: true }
  })

  try {
    expect(await abortUpload.fn.call({ req: {} }, sessionInputs())).toEqual({
      aborted: true
    })
    expect(operation).toBe('abortMultipart')
  } finally {
    sails.helpers.bridge.resolveDirectUploadSession = originalSession
    sails.helpers.bridge.directUploadStorage = originalStorage
  }
})

function stubPrepareHelpers(sails) {
  const originals = {
    prepare: sails.helpers.bridge.prepareUploadTarget,
    storage: sails.helpers.bridge.directUploadStorage,
    intent: sails.helpers.bridge.createDirectUploadIntent
  }
  sails.helpers.bridge.prepareUploadTarget = helper(async () => ({
    project: { id: 12 },
    environment: { id: 13 },
    app: { id: 14 },
    actorId: 15,
    loaded: { resource: { identity: 'lesson' } },
    attribute: { label: 'Video' },
    upload: { accept: ['video/mp4'], maxBytes: 2 * 1024 * MIB },
    storage: { publicUrl: 'https://assets.sailscasts.test' },
    directory: 'courses/durable-ui/welcome',
    configuredFilename: 'state-placement'
  }))
  return () => {
    sails.helpers.bridge.prepareUploadTarget = originals.prepare
    sails.helpers.bridge.directUploadStorage = originals.storage
    sails.helpers.bridge.createDirectUploadIntent = originals.intent
  }
}

function uploadInputs(overrides = {}) {
  return {
    slug: 'sailscasts',
    envSlug: 'production',
    appSlug: 'web',
    modelIdentity: 'lesson',
    fieldName: 'videoUrl',
    values: { course: 'course-1', chapter: 'chapter-1' },
    fileName: 'recording.exe',
    fileType: 'video/mp4',
    fileSize: 4096,
    ...overrides
  }
}

function sessionInputs() {
  return {
    slug: 'sailscasts',
    envSlug: 'production',
    appSlug: 'web',
    modelIdentity: 'lesson',
    fieldName: 'videoUrl',
    uploadIntent: 'signed-multipart-intent'
  }
}

function multipartPayload(overrides = {}) {
  return {
    strategy: 'multipart',
    url: 'https://assets.sailscasts.test/courses/durable-ui/video.mp4',
    objectPath: 'courses/durable-ui/video.mp4',
    fileSize: 93 * MIB,
    fileType: 'video/mp4',
    uploadId: 'r2-upload-id',
    partSize: 16 * MIB,
    partCount: 6,
    ...overrides
  }
}

function helper(fn) {
  fn.with = fn
  return fn
}
