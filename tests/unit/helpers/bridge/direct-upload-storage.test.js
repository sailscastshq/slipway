const { test } = require('sounding')

test('Bridge signs a short-lived direct PUT for the exact R2 object', async ({
  sails,
  expect
}) => {
  const url = await sails.helpers.bridge.createDirectUploadUrl.with({
    storage: {
      key: 'test-access-key',
      secret: 'test-secret-key',
      bucket: 'course-videos',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      region: 'auto'
    },
    objectPath: 'courses/durable-ui/welcome/lesson-opaque.mp4',
    contentType: 'video/mp4'
  })
  const signed = new URL(url)

  expect(signed.origin).toBe('https://account.r2.cloudflarestorage.com')
  expect(signed.pathname).toBe(
    '/course-videos/courses/durable-ui/welcome/lesson-opaque.mp4'
  )
  expect(signed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
  expect(signed.searchParams.get('X-Amz-Expires')).toBe('900')
  expect(signed.searchParams.get('Content-Type')).toBe('video/mp4')
})
