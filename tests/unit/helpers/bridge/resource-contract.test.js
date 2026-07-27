const { test } = require('sounding')

test('Bridge derives a usable resource contract with zero config', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {}
  })

  expect(contract.schemaVersion).toBe(1)
  expect(contract.discover).toBe(true)
  expect(contract.configured).toBe(false)
  expect(contract.resources.course.label).toBe('Courses')
  expect(contract.resources.course.singularLabel).toBe('Course')
  expect(contract.resources.course.title).toBe('title')
  expect(contract.resources.course.list).toEqual([
    'id',
    'title',
    'createdAt',
    'description',
    'thumbnailUrl',
    'published'
  ])
  expect(contract.resources.course.show).toEqual([
    'id',
    'title',
    'description',
    'thumbnailUrl',
    'published',
    'createdAt',
    'updatedAt',
    'creator'
  ])
  expect(contract.resources.course.create).toEqual([
    'title',
    'description',
    'thumbnailUrl',
    'published',
    'password',
    'creator'
  ])
})

test('Bridge normalizes target metadata through its public Sails helper', async ({
  sails,
  expect
}) => {
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-app-web')
      expect(code).toContain(
        'const bridgeConfig = sails.config.slipway?.bridge || {}'
      )
      expect(code).toContain('config: JSON.parse(serializedBridgeConfig)')
      expect(code.includes('packages/hook')).toBe(false)
      const run = new Function('sails', `return (async () => {${code}})();`)
      const output = await run({
        models: modelMetadata(),
        config: {
          slipway: {
            bridge: {
              resources: {
                course: {
                  label: 'Learning paths'
                }
              }
            }
          }
        }
      })

      return {
        success: true,
        output: JSON.stringify(output),
        error: null,
        exitCode: 0
      }
    }

    const introspection = await sails.helpers.bridge.introspectModels.with({
      containerName: 'bridge-app-web',
      environmentId: 217,
      skipCache: true
    })

    expect(introspection.models.course.label).toBe('Learning paths')
    expect(introspection.models.course.primaryKey).toBe('id')
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge merges a partial resource config over discovered metadata', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          label: 'Learning paths',
          group: 'Content',
          search: ['title'],
          list: ['title', 'published']
        },
        auditLog: false
      }
    }
  })

  expect(contract.resources.course.label).toBe('Learning paths')
  expect(contract.resources.course.singularLabel).toBe('Learning path')
  expect(contract.resources.course.group).toBe('Content')
  expect(contract.resources.course.list).toEqual(['id', 'title', 'published'])
  expect(contract.resources.course.create).toEqual([
    'title',
    'description',
    'thumbnailUrl',
    'published',
    'password',
    'creator'
  ])
  expect(contract.resources.auditLog.hidden).toBe(true)
})

test('Bridge represents a fully configured content resource', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      schemaVersion: 1,
      discover: false,
      resources: {
        course: {
          label: 'Courses',
          singularLabel: 'Course',
          group: 'Content',
          title: 'title',
          search: ['title'],
          list: ['title', 'published'],
          show: ['id', 'title', 'description', 'published', 'creator'],
          create: [
            'title',
            'description',
            'thumbnailUrl',
            'published',
            'creator'
          ],
          edit: [
            'title',
            'description',
            'thumbnailUrl',
            'published',
            'creator'
          ],
          filters: ['published'],
          sort: { field: 'title', direction: 'ASC' },
          actions: {
            bulkDelete: false
          },
          fields: {
            description: {
              label: 'Course description',
              type: 'richtext',
              format: 'markdown'
            },
            thumbnailUrl: {
              label: 'Thumbnail',
              type: 'upload',
              upload: {
                kind: 'image',
                storage: 'bridge',
                directory: 'courses/thumbnails',
                store: 'url'
              }
            }
          }
        }
      }
    }
  })

  const resource = contract.resources.course
  expect(Object.keys(contract.resources)).toEqual(['course'])
  expect(resource.sort).toEqual({ field: 'title', direction: 'ASC' })
  expect(resource.actions).toEqual({
    viewAny: true,
    view: true,
    create: true,
    update: true,
    delete: true,
    bulkDelete: false
  })
  expect(resource.attributes.description.field).toEqual({
    label: 'Course description',
    type: 'richtext',
    format: 'markdown'
  })
  expect(resource.attributes.thumbnailUrl.field.upload).toEqual({
    kind: 'image',
    storage: 'bridge',
    directory: 'courses/thumbnails',
    store: 'url'
  })
})

test('Bridge preserves UUID primary keys and derives belongs-to identifier types', async ({
  sails,
  expect
}) => {
  const uuid = '018f2a5c-7b34-7f8a-9c12-4a73b9d80211'
  const authorId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80212'
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: uuidModelMetadata(),
    config: {
      resources: {
        article: {
          create: ['title', 'author']
        }
      }
    }
  })
  const article = contract.resources.article

  expect(article.create).toEqual(['id', 'title', 'author'])
  expect(article.edit.includes('id')).toBe(false)
  expect(article.attributes.author.type).toBe('string')
  expect(article.associations[0]).toEqual({
    alias: 'author',
    type: 'model',
    model: 'author',
    primaryKey: 'id',
    primaryKeyType: 'string'
  })

  const values = await sails.helpers.bridge.allowResourceValues.with({
    resource: article,
    surface: 'create',
    values: {
      id: uuid,
      title: 'UUIDs stay opaque',
      author: authorId
    }
  })

  expect(values.id).toBe(uuid)
  expect(values.author).toBe(authorId)
})

test('Bridge applies configured target helpers to generated primary keys', async ({
  sails,
  expect
}) => {
  const generatedId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80213'
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: uuidModelMetadata(),
    config: {
      resources: {
        article: {
          fields: {
            id: {
              default: {
                helper: 'getUuid'
              }
            }
          }
        }
      }
    }
  })
  const article = contract.resources.article
  const getUuid = async () => generatedId
  getUuid.with = async () => generatedId

  expect(article.create.includes('id')).toBe(false)
  expect(article.attributes.id.field.default).toEqual({
    helper: 'getUuid'
  })

  let forgedPrimaryKeyError
  try {
    await sails.helpers.bridge.allowResourceValues.with({
      resource: article,
      surface: 'create',
      values: {
        id: generatedId,
        title: 'Forged identifier'
      }
    })
  } catch (error) {
    forgedPrimaryKeyError = error
  }
  expect(forgedPrimaryKeyError.code).toBe('BRIDGE_FIELD_NOT_ALLOWED')

  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('article-web')
      const run = new Function('sails', `return (async () => {${code}})();`)
      const output = await run({
        models: {
          article: {
            validate(attribute, value) {
              expect(attribute).toBe('id')
              return value
            },
            create(values) {
              return {
                async fetch() {
                  return values
                }
              }
            }
          }
        },
        helpers: {
          getUuid
        }
      })

      return {
        success: true,
        output: JSON.stringify(output),
        error: null,
        exitCode: 0
      }
    }

    const record = await sails.helpers.bridge.createRecord.with({
      containerName: 'article-web',
      resource: article,
      values: {
        title: 'Generated on the target app'
      }
    })

    expect(record).toEqual({
      id: generatedId,
      title: 'Generated on the target app'
    })
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge only coerces identifiers when their primary key is numeric', async ({
  sails,
  expect
}) => {
  const numericContract =
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {}
    })
  const course = numericContract.resources.course
  const numericValues = await sails.helpers.bridge.allowResourceValues.with({
    resource: course,
    surface: 'create',
    values: {
      title: 'Numeric relationships',
      creator: '7'
    }
  })

  expect(course.attributes.creator.type).toBe('number')
  expect(numericValues.creator).toBe(7)

  const numericId = await sails.helpers.bridge.normalizeIdentifier.with({
    value: '42',
    resource: numericContract.resources.user
  })
  expect(numericId).toBe(42)

  const uuidContract =
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: uuidModelMetadata(),
      config: {}
    })
  const uuid = '018f2a5c-7b34-7f8a-9c12-4a73b9d80214'
  const stringId = await sails.helpers.bridge.normalizeIdentifier.with({
    value: uuid,
    resource: uuidContract.resources.author
  })
  expect(stringId).toBe(uuid)

  let stringAssociationError
  try {
    await sails.helpers.bridge.allowResourceValues.with({
      resource: uuidContract.resources.article,
      surface: 'create',
      values: {
        id: uuid,
        title: 'Do not coerce string relationships',
        author: 42
      }
    })
  } catch (error) {
    stringAssociationError = error
  }
  expect(stringAssociationError.code).toBe('BRIDGE_INVALID_IDENTIFIER')
})

test('Bridge rejects unsafe generated primary key helper identities', async ({
  sails,
  expect
}) => {
  let receivedError

  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: uuidModelMetadata(),
      config: {
        resources: {
          article: {
            fields: {
              id: {
                default: {
                  helper: '__proto__.getUuid'
                }
              }
            }
          }
        }
      }
    })
  } catch (error) {
    receivedError = error
  }

  expect(receivedError.message).toBe(
    'Bridge field "article.id".default.helper must be a safe Sails helper identity.'
  )
})

test('Bridge rejects unknown fields and unsupported config options', async ({
  sails,
  expect
}) => {
  let unknownFieldError
  let unknownOptionError

  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        resources: {
          course: {
            list: ['title', 'missing']
          }
        }
      }
    })
  } catch (error) {
    unknownFieldError = error
  }

  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        resources: {
          course: {
            magic: true
          }
        }
      }
    })
  } catch (error) {
    unknownOptionError = error
  }

  expect(unknownFieldError.message).toBe(
    'Bridge resource "course".list references unknown field "missing".'
  )
  expect(unknownOptionError.message).toBe(
    'Bridge resource "course" contains unsupported option "magic".'
  )
})

test('Bridge query normalization treats sort and search as data', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          search: ['title'],
          list: ['title', 'published'],
          sort: { field: 'title', direction: 'ASC' }
        }
      }
    }
  })

  const query = await sails.helpers.bridge.normalizeResourceQuery.with({
    resource: contract.resources.course,
    page: -4,
    perPage: 5000,
    sort: "title ASC'; process.exit(1); //",
    search: "Robert'); throw new Error('nope"
  })

  expect(query.page).toBe(1)
  expect(query.perPage).toBe(100)
  expect(query.sort).toBe('title ASC')
  expect(query.select).toEqual(['id', 'title', 'published'])
  expect(query.where).toEqual({
    or: [
      {
        title: {
          contains: "Robert'); throw new Error('nope"
        }
      }
    ]
  })
})

test('Bridge rejects forged mutation fields before container execution', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          create: ['title', 'published']
        }
      }
    }
  })
  let receivedError

  try {
    await sails.helpers.bridge.allowResourceValues.with({
      resource: contract.resources.course,
      surface: 'create',
      values: {
        title: 'Safe title',
        isAdmin: true
      }
    })
  } catch (error) {
    receivedError = error
  }

  expect(receivedError.code).toBe('BRIDGE_FIELD_NOT_ALLOWED')
  expect(receivedError.fields).toEqual(['isAdmin'])
})

test('Bridge denies raw HTML in Markdown fields by default', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          create: ['title', 'description'],
          fields: {
            description: {
              type: 'richtext',
              format: 'markdown'
            }
          }
        }
      }
    }
  })

  const safeValues = await sails.helpers.bridge.allowResourceValues.with({
    resource: contract.resources.course,
    surface: 'create',
    values: {
      title: 'A safe course',
      description:
        '## Ship calmly\n\nRead <https://sailsjs.com> and keep **building**.'
    }
  })
  expect(safeValues.description).toContain('**building**')

  for (const description of [
    'Before <script>alert(1)</script> after.',
    '<svg/onload=alert(1)>',
    '<FeatureCard title="Slipway" />',
    '<!-- hidden markup -->'
  ]) {
    let receivedError

    try {
      await sails.helpers.bridge.allowResourceValues.with({
        resource: contract.resources.course,
        surface: 'create',
        values: {
          title: 'Unsafe course',
          description
        }
      })
    } catch (error) {
      receivedError = error
    }

    expect(receivedError.code).toBe('BRIDGE_MARKDOWN_HTML_NOT_ALLOWED')
    expect(receivedError.fields).toEqual(['description'])
  }
})

test('Bridge resource loading rejects hidden and disabled resources server-side', async ({
  sails,
  expect
}) => {
  const originalIntrospectModels = sails.helpers.bridge.introspectModels
  sails.helpers.bridge.introspectModels = async () => ({
    models: {
      course: {
        identity: 'course',
        singularLabel: 'Course',
        hidden: false,
        actions: {
          update: false
        }
      },
      auditLog: {
        identity: 'auditLog',
        singularLabel: 'Audit log',
        hidden: true,
        actions: {}
      }
    }
  })

  let disabledActionError
  let hiddenResourceError
  let prototypeResourceError

  try {
    try {
      await sails.helpers.bridge.loadResource.with({
        containerName: 'app',
        environmentId: 1,
        modelIdentity: 'course',
        action: 'update'
      })
    } catch (error) {
      disabledActionError = error
    }

    try {
      await sails.helpers.bridge.loadResource.with({
        containerName: 'app',
        environmentId: 1,
        modelIdentity: 'auditLog',
        action: 'view'
      })
    } catch (error) {
      hiddenResourceError = error
    }

    try {
      await sails.helpers.bridge.loadResource.with({
        containerName: 'app',
        environmentId: 1,
        modelIdentity: '__proto__',
        action: 'view'
      })
    } catch (error) {
      prototypeResourceError = error
    }
  } finally {
    sails.helpers.bridge.introspectModels = originalIntrospectModels
  }

  expect(disabledActionError.code).toBe('BRIDGE_ACTION_NOT_ALLOWED')
  expect(hiddenResourceError.code).toBe('BRIDGE_RESOURCE_NOT_FOUND')
  expect(prototypeResourceError.code).toBe('BRIDGE_RESOURCE_NOT_FOUND')
})

function modelMetadata() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'course',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'number',
          autoIncrement: true
        },
        title: {
          type: 'string',
          required: true
        },
        description: {
          type: 'string',
          columnType: 'text'
        },
        thumbnailUrl: {
          type: 'string'
        },
        published: {
          type: 'boolean',
          defaultsTo: false
        },
        password: {
          type: 'string',
          encrypt: true
        },
        internalNotes: {
          type: 'string',
          protect: true
        },
        createdAt: {
          type: 'number',
          autoCreatedAt: true
        },
        updatedAt: {
          type: 'number',
          autoUpdatedAt: true
        },
        creator: {
          type: 'string',
          model: 'user'
        }
      },
      associations: [
        {
          alias: 'creator',
          type: 'model',
          model: 'user'
        }
      ]
    },
    user: {
      identity: 'user',
      globalId: 'User',
      tableName: 'users',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'number',
          autoIncrement: true
        },
        fullName: {
          type: 'string',
          required: true
        }
      },
      associations: []
    },
    auditLog: {
      identity: 'auditLog',
      globalId: 'AuditLog',
      tableName: 'audit_log',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'string'
        },
        event: {
          type: 'string'
        }
      },
      associations: []
    }
  }
}

function uuidModelMetadata() {
  return {
    article: {
      identity: 'article',
      globalId: 'Article',
      tableName: 'articles',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'string',
          required: true,
          isUUID: true
        },
        title: {
          type: 'string',
          required: true
        },
        author: {
          type: 'number',
          model: 'author',
          required: true
        }
      },
      associations: [
        {
          alias: 'author',
          type: 'model',
          model: 'author'
        }
      ]
    },
    author: {
      identity: 'author',
      globalId: 'Author',
      tableName: 'authors',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'string',
          required: true,
          isUUID: true
        },
        fullName: {
          type: 'string',
          required: true
        }
      },
      associations: []
    }
  }
}
