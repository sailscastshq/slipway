const { test } = require('sounding')
const bridgeUploadField = require('../../../api/controllers/project/bridge-upload-field')

test('Bridge streams inline Markdown images through the configured field boundary', async ({
  sails,
  expect
}) => {
  const originalTarget = sails.helpers.bridge.prepareUploadTarget
  const originalReceipt = sails.helpers.bridge.createUploadReceipt
  let uploadOptions

  sails.helpers.bridge.prepareUploadTarget = helper(async () => ({
    project: { id: 12 },
    environment: { id: 13 },
    actorId: 15,
    loaded: { resource: { identity: 'lesson' } },
    attribute: { label: 'Description' },
    upload: { accept: ['image/png'], maxBytes: 10 * 1024 * 1024 },
    storage: storage('https://cdn.sailscasts.test'),
    directory:
      'bridge/teams/7/projects/12/environments/13/lesson/description/lessons/descriptions',
    configuredFilename: ''
  }))
  sails.helpers.bridge.createUploadReceipt = helper(
    async () => 'signed-inline-image-receipt'
  )

  try {
    const result = await bridgeUploadField.fn.call(
      {
        req: uploadRequest(
          'image/png',
          'deployment-diagram.png',
          2048,
          (value) => (uploadOptions = value)
        )
      },
      {
        slug: 'sailscasts',
        envSlug: 'production',
        appSlug: 'web',
        modelIdentity: 'lesson',
        fieldName: 'description'
      }
    )

    expect(uploadOptions.maxBytes).toBe(10 * 1024 * 1024)
    expect(uploadOptions.dirname).toContain(
      'bridge/teams/7/projects/12/environments/13/lesson/description/lessons/descriptions'
    )
    expect(result.url).toContain('https://cdn.sailscasts.test/bridge/')
    expect(result.receipt).toBe('signed-inline-image-receipt')
  } finally {
    sails.helpers.bridge.prepareUploadTarget = originalTarget
    sails.helpers.bridge.createUploadReceipt = originalReceipt
  }
})

test('Bridge writes a collision-safe video path at the bucket root', async ({
  sails,
  expect
}) => {
  const originalTarget = sails.helpers.bridge.prepareUploadTarget
  const originalReceipt = sails.helpers.bridge.createUploadReceipt
  let uploadOptions
  let receivedValues

  sails.helpers.bridge.prepareUploadTarget = helper(async ({ values }) => {
    receivedValues = values
    return {
      project: { id: 12 },
      environment: { id: 13 },
      actorId: 15,
      loaded: { resource: { identity: 'lesson' } },
      attribute: { label: 'Video' },
      upload: {
        accept: ['video/mp4'],
        maxBytes: 2 * 1024 * 1024 * 1024
      },
      storage: storage('https://assets.example.com'),
      directory: 'courses/introduction',
      configuredFilename: 'course-assumptions'
    }
  })
  sails.helpers.bridge.createUploadReceipt = helper(
    async () => 'signed-video-receipt'
  )

  try {
    const result = await bridgeUploadField.fn.call(
      {
        req: uploadRequest(
          'video/mp4',
          'untrusted-name.exe',
          4096,
          (value) => (uploadOptions = value)
        )
      },
      {
        slug: 'courses',
        envSlug: 'production',
        appSlug: 'web',
        modelIdentity: 'lesson',
        fieldName: 'videoUrl',
        values: JSON.stringify({ title: 'Course assumptions' })
      }
    )

    expect(receivedValues).toEqual({ title: 'Course assumptions' })
    expect(uploadOptions.dirname).toBe('courses/introduction')
    expect(result.url).toMatch(
      /^https:\/\/assets\.example\.com\/courses\/introduction\/course-assumptions-[0-9a-f-]{36}\.mp4$/
    )
    expect(result.receipt).toBe('signed-video-receipt')
  } finally {
    sails.helpers.bridge.prepareUploadTarget = originalTarget
    sails.helpers.bridge.createUploadReceipt = originalReceipt
  }
})

function uploadRequest(type, filename, size, captureOptions) {
  return {
    file() {
      return {
        upload(options, done) {
          captureOptions(options)
          options.saveAs({ type, filename }, (error, generatedName) => {
            if (error) return done(error)
            done(null, [
              {
                fd: `${options.dirname}/${generatedName}`,
                filename,
                size,
                type
              }
            ])
          })
        }
      }
    }
  }
}

function storage(publicUrl) {
  return {
    key: 'test-key',
    secret: 'test-secret',
    bucket: 'courses',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    publicUrl,
    region: 'auto'
  }
}

function helper(fn) {
  fn.with = fn
  return fn
}
