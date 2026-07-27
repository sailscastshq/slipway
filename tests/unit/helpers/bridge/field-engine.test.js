const { test } = require('sounding')

test('Bridge normalizes typed fields and resolves currency for display', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: fieldModelMetadata(),
    config: fieldResourceConfig()
  })
  const course = contract.resources.course

  expect(course.attributes.email.field.type).toBe('email')
  expect(course.attributes.website.field.type).toBe('url')
  expect(course.attributes.metadata.field.type).toBe('json')
  expect(course.attributes.published.field.type).toBe('boolean')
  expect(course.attributes.releaseDate.field.type).toBe('date')
  expect(course.attributes.status.field.options).toEqual([
    { label: 'Draft', value: 'draft', disabled: false },
    { label: 'Published', value: 'published', disabled: false }
  ])
  expect(course.attributes.description.field).toEqual({
    type: 'richtext',
    format: 'markdown',
    help: 'The public course description.'
  })
  expect(course.attributes.price.field.currency).toEqual({
    code: 'USD',
    locale: 'en-US',
    storage: 'minor',
    submit: 'major',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  expect(course.attributes.thumbnailUrl.field.upload).toEqual({
    kind: 'image',
    storage: 'bridge',
    directory: 'courses/thumbnails',
    store: 'url',
    accept: [
      'image/avif',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp'
    ],
    maxBytes: 5 * 1024 * 1024
  })

  const record = await sails.helpers.bridge.redactResourceRecords.with({
    records: {
      id: 1,
      title: 'Build with Sails',
      price: 3499
    },
    resource: course,
    surface: 'edit'
  })

  expect(record.price).toBe(34.99)
})

test('Bridge hydrates typed values before target lifecycle callbacks', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: fieldModelMetadata(),
    config: fieldResourceConfig()
  })

  const values = await sails.helpers.bridge.allowResourceValues.with({
    resource: contract.resources.course,
    surface: 'create',
    values: {
      title: 'A typed course',
      description: 'Write with **Markdown**.',
      email: 'editor@example.com',
      website: 'https://sailsjs.com',
      metadata: '{"level":"production"}',
      published: true,
      status: 'draft',
      price: 34.99
    }
  })

  expect(values.metadata).toEqual({ level: 'production' })
  expect(values.website).toBe('https://sailsjs.com/')
  expect(values.price).toBe(34.99)
})

test('Bridge can submit currency as minor units when the target expects them', async ({
  sails,
  expect
}) => {
  const config = fieldResourceConfig()
  config.resources.course.fields.price.currency.submit = 'minor'
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: fieldModelMetadata(),
    config
  })

  const values = await sails.helpers.bridge.allowResourceValues.with({
    resource: contract.resources.course,
    surface: 'create',
    values: {
      title: 'Minor units',
      email: 'editor@example.com',
      website: 'https://example.com',
      metadata: {},
      published: false,
      status: 'draft',
      price: 34.99
    }
  })

  expect(values.price).toBe(3499)
})

test('Bridge returns field errors for invalid typed values', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: fieldModelMetadata(),
    config: fieldResourceConfig()
  })
  let receivedError

  try {
    await sails.helpers.bridge.allowResourceValues.with({
      resource: contract.resources.course,
      surface: 'create',
      values: {
        title: '',
        email: 'not-an-email',
        website: 'javascript:alert(1)',
        metadata: '{broken',
        published: 'yes',
        status: 'retired',
        price: 'free',
        releaseDate: '2026-02-31'
      }
    })
  } catch (error) {
    receivedError = error
  }

  expect(receivedError.code).toBe('BRIDGE_FIELD_INVALID')
  expect(Object.keys(receivedError.fieldErrors).sort()).toEqual([
    'email',
    'metadata',
    'price',
    'published',
    'releaseDate',
    'status',
    'title',
    'website'
  ])
})

test('Bridge upload receipts bind URLs to the actor and field', async ({
  sails,
  expect
}) => {
  const originalSecret = sails.config.session.secret
  sails.config.session.secret =
    'bridge-upload-test-secret-that-is-long-and-unique'
  const context = {
    actorId: 7,
    projectId: 11,
    environmentId: 13,
    resource: 'course',
    field: 'thumbnailUrl'
  }
  const url = 'https://cdn.example.com/bridge/course/thumbnail.webp'

  try {
    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: fieldModelMetadata(),
      config: fieldResourceConfig()
    })
    const receipt = await sails.helpers.bridge.createUploadReceipt.with({
      url,
      context
    })
    const verified = await sails.helpers.bridge.verifyUploadReceipt.with({
      receipt,
      url,
      context
    })
    expect(verified).toBe(url)
    const values = await sails.helpers.bridge.allowResourceValues.with({
      resource: contract.resources.course,
      surface: 'edit',
      values: {
        thumbnailUrl: { url, receipt }
      },
      uploadContext: {
        actorId: context.actorId,
        projectId: context.projectId,
        environmentId: context.environmentId
      }
    })
    expect(values.thumbnailUrl).toBe(url)

    let forgedError
    try {
      await sails.helpers.bridge.verifyUploadReceipt.with({
        receipt,
        url: 'https://evil.example/forged.webp',
        context
      })
    } catch (error) {
      forgedError = error
    }
    expect(forgedError.code).toBe('BRIDGE_UPLOAD_RECEIPT_INVALID')
  } finally {
    sails.config.session.secret = originalSecret
  }
})

test('Bridge upload storage uses only scoped BRIDGE_ settings', async ({
  sails,
  expect
}) => {
  const originalSettingGet = sails.helpers.setting.get
  sails.helpers.setting.get = async () =>
    JSON.stringify({
      BRIDGE_STORAGE_PROVIDER: 'r2',
      BRIDGE_R2_ACCESS_KEY: 'global-key',
      BRIDGE_R2_SECRET_KEY: 'global-secret',
      BRIDGE_R2_BUCKET: 'global-bucket',
      BRIDGE_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      BRIDGE_R2_PUBLIC_URL: 'https://cdn.example.com',
      R2_SECRET_KEY: 'must-not-leak'
    })

  try {
    const storage = await sails.helpers.bridge.getUploadStorageConfig.with({
      environment: {
        envVars: {
          BRIDGE_R2_BUCKET: 'environment-bucket'
        }
      },
      app: {
        envVars: {
          BRIDGE_R2_ACCESS_KEY: 'app-key'
        }
      }
    })

    expect(storage).toEqual({
      provider: 'r2',
      key: 'app-key',
      secret: 'global-secret',
      bucket: 'environment-bucket',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      publicUrl: 'https://cdn.example.com',
      region: 'auto'
    })
  } finally {
    sails.helpers.setting.get = originalSettingGet
  }
})

function fieldResourceConfig() {
  return {
    resources: {
      course: {
        create: [
          'title',
          'description',
          'email',
          'website',
          'metadata',
          'published',
          'status',
          'price',
          'releaseDate',
          'thumbnailUrl'
        ],
        edit: [
          'title',
          'description',
          'email',
          'website',
          'metadata',
          'published',
          'status',
          'price',
          'releaseDate',
          'thumbnailUrl'
        ],
        fields: {
          description: {
            type: 'richtext',
            format: 'markdown',
            help: 'The public course description.'
          },
          status: {
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' }
            ]
          },
          price: {
            type: 'currency',
            currency: {
              code: 'USD',
              storage: 'minor',
              submit: 'major'
            }
          },
          thumbnailUrl: {
            type: 'image',
            upload: {
              storage: 'bridge',
              directory: 'courses/thumbnails'
            }
          }
        }
      }
    }
  }
}

function fieldModelMetadata() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'courses',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        title: { type: 'string', required: true },
        description: { type: 'string', columnType: 'text' },
        email: { type: 'string', required: true, isEmail: true },
        website: { type: 'string', required: true, isURL: true },
        metadata: { type: 'json', required: true },
        published: { type: 'boolean', required: true },
        status: {
          type: 'string',
          required: true,
          isIn: ['draft', 'published']
        },
        price: { type: 'number', required: true },
        releaseDate: { type: 'string', columnType: 'date' },
        thumbnailUrl: { type: 'string' },
        createdAt: { type: 'number', autoCreatedAt: true }
      },
      associations: []
    }
  }
}
