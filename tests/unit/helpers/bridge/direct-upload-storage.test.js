const { test } = require('sounding')

const storage = {
  key: 'test-access-key',
  secret: 'test-secret-key',
  bucket: 'course-videos',
  endpoint: 'https://account.r2.cloudflarestorage.com',
  region: 'auto'
}

test('Bridge signs a short-lived direct PUT for the exact R2 object', async ({
  sails,
  expect
}) => {
  const result = await sails.helpers.bridge.directUploadStorage.with({
    operation: 'signPut',
    storage,
    objectPath: 'courses/durable-ui/welcome/lesson-opaque.mp4',
    contentType: 'video/mp4'
  })
  const signed = new URL(result.uploadUrl)

  expect(signed.origin).toBe('https://account.r2.cloudflarestorage.com')
  expect(signed.pathname).toBe(
    '/course-videos/courses/durable-ui/welcome/lesson-opaque.mp4'
  )
  expect(signed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
  expect(signed.searchParams.get('X-Amz-Expires')).toBe('3600')
  expect(signed.searchParams.get('Content-Type')).toBe('video/mp4')
})

test('Bridge signs only explicit numbered multipart parts', async ({
  sails,
  expect
}) => {
  const result = await sails.helpers.bridge.directUploadStorage.with({
    operation: 'signParts',
    storage,
    objectPath: 'courses/durable-ui/welcome/lesson-opaque.mp4',
    uploadId: 'opaque-upload-id',
    partNumbers: [2, 4]
  })

  expect(result.parts.map(({ partNumber }) => partNumber)).toEqual([2, 4])
  for (const part of result.parts) {
    const signed = new URL(part.uploadUrl)
    expect(signed.searchParams.get('partNumber')).toBe(String(part.partNumber))
    expect(signed.searchParams.get('uploadId')).toBe('opaque-upload-id')
  }
})
