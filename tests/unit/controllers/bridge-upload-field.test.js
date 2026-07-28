const { test } = require('sounding')
const bridgeUploadField = require('../../../api/controllers/project/bridge-upload-field')

test('Bridge streams inline Markdown images through the configured field boundary', async ({
  sails,
  expect
}) => {
  const originals = {
    resolveRequest: sails.helpers.bridge.resolveRequest,
    loadResource: sails.helpers.bridge.loadResource,
    getUploadStorageConfig: sails.helpers.bridge.getUploadStorageConfig,
    createUploadReceipt: sails.helpers.bridge.createUploadReceipt
  }
  let uploadOptions

  sails.helpers.bridge.resolveRequest = helper(async () => ({
    project: { id: 12, team: 7 },
    environment: { id: 13 },
    app: { id: 14, containerName: 'sailscasts-web' },
    actor: { id: 15, email: 'editor@sailscasts.com' },
    actorId: 15
  }))
  sails.helpers.bridge.loadResource = helper(async () => ({
    resource: {
      identity: 'lesson',
      create: ['title', 'description'],
      edit: ['title', 'description'],
      attributes: {
        description: {
          label: 'Description',
          field: {
            type: 'richtext',
            format: 'markdown',
            upload: {
              kind: 'image',
              storage: 'bridge',
              directory: 'lessons/descriptions',
              store: 'url',
              accept: ['image/png'],
              maxBytes: 10 * 1024 * 1024
            }
          }
        }
      }
    }
  }))
  sails.helpers.bridge.getUploadStorageConfig = helper(async () => ({
    provider: 'r2',
    key: 'test-key',
    secret: 'test-secret',
    bucket: 'sailscasts',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    publicUrl: 'https://cdn.sailscasts.test',
    region: 'auto'
  }))
  sails.helpers.bridge.createUploadReceipt = helper(
    async () => 'signed-inline-image-receipt'
  )

  const req = {
    file(name) {
      expect(name).toBe('file')
      return {
        upload(options, done) {
          uploadOptions = options
          options.saveAs(
            {
              type: 'image/png',
              filename: 'deployment-diagram.png'
            },
            (error, generatedName) => {
              if (error) return done(error)
              done(null, [
                {
                  fd: `/tmp/${generatedName}`,
                  filename: 'deployment-diagram.png',
                  size: 2048,
                  type: 'image/png'
                }
              ])
            }
          )
        }
      }
    }
  }

  try {
    const result = await bridgeUploadField.fn.call(
      { req },
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
    expect(result.url).toContain('/lesson/description/lessons/descriptions/')
    expect(result.receipt).toBe('signed-inline-image-receipt')
  } finally {
    sails.helpers.bridge.resolveRequest = originals.resolveRequest
    sails.helpers.bridge.loadResource = originals.loadResource
    sails.helpers.bridge.getUploadStorageConfig =
      originals.getUploadStorageConfig
    sails.helpers.bridge.createUploadReceipt = originals.createUploadReceipt
  }
})

test('Bridge writes an explicitly configured video path at the bucket root using the accepted MIME extension', async ({
  sails,
  expect
}) => {
  const originals = {
    resolveRequest: sails.helpers.bridge.resolveRequest,
    loadResource: sails.helpers.bridge.loadResource,
    getUploadStorageConfig: sails.helpers.bridge.getUploadStorageConfig,
    authorizeRelationshipValues:
      sails.helpers.bridge.authorizeRelationshipValues,
    resolveUploadObjectPath: sails.helpers.bridge.resolveUploadObjectPath,
    createUploadReceipt: sails.helpers.bridge.createUploadReceipt
  }
  let uploadOptions
  let receivedValues

  sails.helpers.bridge.resolveRequest = helper(async () => ({
    project: { id: 12, team: 7 },
    environment: { id: 13 },
    app: { id: 14, containerName: 'course-web' },
    actor: { id: 15, email: 'editor@example.com' },
    actorId: 15
  }))
  sails.helpers.bridge.loadResource = helper(async () => {
    const resource = {
      identity: 'lesson',
      create: ['title', 'videoUrl'],
      edit: ['title', 'videoUrl'],
      attributes: {
        videoUrl: {
          label: 'Video',
          field: {
            type: 'upload',
            upload: {
              kind: 'file',
              storage: 'bridge',
              scope: 'bucket',
              directory: 'courses/introduction',
              filename: '{title|slug}',
              store: 'url',
              accept: ['video/mp4'],
              maxBytes: 2 * 1024 * 1024 * 1024
            }
          }
        }
      }
    }
    return {
      resource,
      contract: { models: { lesson: resource } }
    }
  })
  sails.helpers.bridge.getUploadStorageConfig = helper(async () => ({
    provider: 'r2',
    key: 'test-key',
    secret: 'test-secret',
    bucket: 'courses',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    publicUrl: 'https://assets.example.com',
    region: 'auto'
  }))
  sails.helpers.bridge.authorizeRelationshipValues = helper(async () => {})
  sails.helpers.bridge.resolveUploadObjectPath = helper(async ({ values }) => {
    receivedValues = values
    return {
      directory: 'courses/introduction',
      filename: 'course-assumptions'
    }
  })
  sails.helpers.bridge.createUploadReceipt = helper(
    async () => 'signed-video-receipt'
  )

  const req = {
    file() {
      return {
        upload(options, done) {
          uploadOptions = options
          options.saveAs(
            {
              type: 'video/mp4',
              filename: 'untrusted-name.exe'
            },
            (error, generatedName) => {
              if (error) return done(error)
              done(null, [
                {
                  fd: `courses/introduction/${generatedName}`,
                  filename: 'untrusted-name.exe',
                  size: 4096,
                  type: 'video/mp4'
                }
              ])
            }
          )
        }
      }
    }
  }

  try {
    const result = await bridgeUploadField.fn.call(
      { req },
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
    expect(result.url).toBe(
      'https://assets.example.com/courses/introduction/course-assumptions.mp4'
    )
    expect(result.receipt).toBe('signed-video-receipt')
  } finally {
    sails.helpers.bridge.resolveRequest = originals.resolveRequest
    sails.helpers.bridge.loadResource = originals.loadResource
    sails.helpers.bridge.getUploadStorageConfig =
      originals.getUploadStorageConfig
    sails.helpers.bridge.authorizeRelationshipValues =
      originals.authorizeRelationshipValues
    sails.helpers.bridge.resolveUploadObjectPath =
      originals.resolveUploadObjectPath
    sails.helpers.bridge.createUploadReceipt = originals.createUploadReceipt
  }
})

function helper(fn) {
  fn.with = fn
  return fn
}
