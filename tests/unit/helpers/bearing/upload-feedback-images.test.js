const { test } = require('sounding')
const uploadFeedbackImages = require('../../../../api/helpers/bearing/upload-feedback-images')

test('Bearing streams every image immediately into its app-scoped storage path', async ({
  expect
}) => {
  const started = []
  const request = uploadRequest(
    {
      image0: {
        filename: 'screenshot.png',
        size: 2048,
        type: 'image/png'
      },
      image1: {
        filename: 'flow.webp',
        size: 4096,
        type: 'image/webp'
      }
    },
    started
  )

  const images = await uploadFeedbackImages.fn({
    req: request,
    storage: storage(),
    directory: 'bearing/teams/7/projects/12/apps/14/feedback/bfd_test',
    fields: ['image0', 'image1']
  })

  expect(started).toEqual(['image0', 'image1'])
  expect(images.length).toBe(2)
  expect(images[0].url).toMatch(
    /^https:\/\/assets\.slipway\.test\/bearing\/teams\/7\/projects\/12\/apps\/14\/feedback\/bfd_test\/[0-9a-f-]+\.png$/
  )
  expect(images[1].url).toMatch(/\.webp$/)
  expect(images[0].objectPath).toContain(
    'bearing/teams/7/projects/12/apps/14/feedback/bfd_test/'
  )
})

test('Bearing cleans up completed objects when another image fails', async ({
  sails,
  expect
}) => {
  const originalDelete = sails.helpers.bearing.deleteFeedbackImages
  let cleanup
  sails.helpers.bearing.deleteFeedbackImages = helper(async (values) => {
    cleanup = values
  })

  try {
    let receivedError
    try {
      await uploadFeedbackImages.fn({
        req: uploadRequest(
          {
            image0: {
              filename: 'good.png',
              size: 1024,
              type: 'image/png'
            },
            image1: {
              filename: 'unsafe.svg',
              size: 1024,
              type: 'image/svg+xml'
            }
          },
          []
        ),
        storage: storage(),
        directory: 'bearing/feedback/bfd_partial',
        fields: ['image0', 'image1']
      })
    } catch (error) {
      receivedError = error
    }

    expect(receivedError.code).toBe('BEARING_UPLOAD_TYPE_NOT_ALLOWED')
    expect(cleanup.images.length).toBe(1)
    expect(cleanup.images[0].objectPath).toContain(
      'bearing/feedback/bfd_partial'
    )
  } finally {
    sails.helpers.bearing.deleteFeedbackImages = originalDelete
  }
})

test('Bearing requires a public file URL before accepting an image', async ({
  expect
}) => {
  let receivedError
  try {
    await uploadFeedbackImages.fn({
      req: uploadRequest({}, []),
      storage: { ...storage(), publicUrl: undefined },
      directory: 'bearing/feedback/bfd_no_public_url',
      fields: ['image0']
    })
  } catch (error) {
    receivedError = error
  }

  expect(receivedError.code).toBe('BEARING_UPLOAD_PUBLIC_URL_REQUIRED')
})

test('Bearing accepts the rich editor image field', async ({ expect }) => {
  const images = await uploadFeedbackImages.fn({
    upstream: uploadRequest(
      {
        image: {
          filename: 'update.png',
          size: 1024,
          type: 'image/png'
        }
      },
      []
    ).file('image'),
    storage: storage(),
    directory: 'bearing/teams/7/projects/12/apps/14/updates/assets',
    fields: []
  })

  expect(images.length).toBe(1)
  expect(images[0].objectPath).toContain('/updates/assets/')
})

function uploadRequest(files, started) {
  return {
    file(field) {
      return {
        upload(options, done) {
          started.push(field)
          const incoming = files[field]
          options.saveAs(incoming, (error, generatedName) => {
            if (error) return done(error)
            done(null, [
              {
                fd: `${options.dirname}/${generatedName}`,
                filename: incoming.filename,
                size: incoming.size,
                type: incoming.type
              }
            ])
          })
        }
      }
    }
  }
}

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
