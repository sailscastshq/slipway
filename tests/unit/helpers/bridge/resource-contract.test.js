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
    scope: 'environment',
    directory: 'courses/thumbnails',
    filename: '',
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
})

test('Bridge gives Markdown rich text an app-scoped inline image upload contract', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          create: ['title', 'description'],
          edit: ['title', 'description'],
          fields: {
            description: {
              type: 'richtext',
              format: 'markdown',
              upload: {
                kind: 'image',
                storage: 'bridge',
                directory: 'courses/descriptions',
                store: 'url',
                accept: ['image/jpeg', 'image/png', 'image/webp'],
                maxBytes: 10 * 1024 * 1024
              }
            }
          }
        }
      }
    }
  })

  expect(contract.resources.course.attributes.description.field.upload).toEqual(
    {
      kind: 'image',
      storage: 'bridge',
      scope: 'environment',
      directory: 'courses/descriptions',
      filename: '',
      store: 'url',
      accept: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: 10 * 1024 * 1024
    }
  )

  let fileKindError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        resources: {
          course: {
            fields: {
              description: {
                type: 'richtext',
                format: 'markdown',
                upload: {
                  kind: 'file'
                }
              }
            }
          }
        }
      }
    })
  } catch (error) {
    fileKindError = error
  }

  expect(fileKindError.message).toContain(
    'upload.kind must be "image" for Markdown rich text'
  )
})

test('Bridge normalizes generic bucket-root upload path templates', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          create: ['title', 'thumbnailUrl', 'creator'],
          edit: ['title', 'thumbnailUrl', 'creator'],
          fields: {
            thumbnailUrl: {
              type: 'upload',
              upload: {
                kind: 'image',
                scope: 'bucket',
                directory: '{creator.fullName|slug}/{title|slug}',
                filename: '{title|slug}'
              }
            }
          }
        }
      }
    }
  })

  expect(
    contract.resources.course.attributes.thumbnailUrl.field.upload
  ).toEqual({
    kind: 'image',
    storage: 'bridge',
    scope: 'bucket',
    directory: '{creator.fullName|slug}/{title|slug}',
    filename: '{title|slug}',
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

  let traversalError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        resources: {
          course: {
            fields: {
              thumbnailUrl: {
                type: 'upload',
                upload: {
                  directory: '../{title|slug}'
                }
              }
            }
          }
        }
      }
    })
  } catch (error) {
    traversalError = error
  }

  expect(traversalError.message).toContain(
    'must be a safe relative object-path template'
  )

  let referenceError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        resources: {
          course: {
            fields: {
              thumbnailUrl: {
                type: 'upload',
                upload: {
                  directory: '{missing.slug}'
                }
              }
            }
          }
        }
      }
    })
  } catch (error) {
    referenceError = error
  }

  expect(referenceError.message).toContain(
    'path reference "{missing.slug}" must use an available, non-sensitive scalar field'
  )
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

test('Bridge normalizes bounded relationships and keeps collection mutations opt-in', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: relationshipModelMetadata(),
    config: {
      resources: {
        lesson: {
          show: ['id', 'title', 'chapter', 'course', 'creator'],
          fields: {
            chapter: {
              relation: {
                label: 'Chapter',
                search: ['title'],
                limit: 12
              }
            }
          }
        },
        course: {
          relationships: {
            chapters: {
              label: 'Course chapters',
              fields: ['id', 'title'],
              search: ['title'],
              limit: 8,
              attach: true,
              detach: true
            },
            lessons: {
              limit: 6
            }
          }
        }
      }
    }
  })

  const lesson = contract.resources.lesson
  expect(lesson.relationships.chapter).toEqual({
    alias: 'chapter',
    type: 'model',
    resource: 'chapter',
    label: 'Chapter',
    primaryKey: 'id',
    title: 'title',
    show: true,
    searchable: true,
    search: ['title'],
    fields: ['id', 'title'],
    limit: 12,
    attach: false,
    detach: false
  })
  expect(lesson.attributes.chapter.field.relation).toEqual(
    lesson.relationships.chapter
  )
  expect(lesson.relationships.course.primaryKey).toBe('id')
  expect(lesson.relationships.creator.title).toBe('fullName')

  const course = contract.resources.course
  expect(course.relationships.chapters).toEqual({
    alias: 'chapters',
    type: 'collection',
    resource: 'chapter',
    label: 'Course chapters',
    primaryKey: 'id',
    title: 'title',
    show: true,
    searchable: true,
    search: ['title'],
    fields: ['id', 'title'],
    limit: 8,
    attach: true,
    detach: true,
    via: 'course'
  })
  expect(course.relationships.lessons.attach).toBe(false)
  expect(course.relationships.lessons.detach).toBe(false)
  expect(course.relationships.lessons.limit).toBe(6)
})

test('Bridge rejects unsafe relationship configuration', async ({
  sails,
  expect
}) => {
  let mutationError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: relationshipModelMetadata(),
      config: {
        resources: {
          lesson: {
            fields: {
              chapter: {
                relation: {
                  attach: true
                }
              }
            }
          }
        }
      }
    })
  } catch (error) {
    mutationError = error
  }
  expect(mutationError.message).toContain(
    'can enable attach or detach only for a collection association'
  )

  let fieldError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: relationshipModelMetadata(),
      config: {
        resources: {
          course: {
            relationships: {
              chapters: {
                fields: ['internalNotes']
              }
            }
          }
        }
      }
    })
  } catch (error) {
    fieldError = error
  }
  expect(fieldError.message).toContain(
    'fields references unavailable field "internalNotes"'
  )
})

test('Bridge normalizes fixed and dependent relationship scopes', async ({
  sails,
  expect
}) => {
  const courseId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80251'
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: relationshipModelMetadata(),
    config: {
      resources: {
        lesson: {
          fields: {
            chapter: {
              relation: {
                where: {
                  course: { fromField: 'course' }
                }
              }
            },
            creator: {
              relation: {
                where: {
                  role: { in: ['editor', 'admin'] }
                }
              }
            }
          }
        }
      }
    }
  })

  expect(contract.resources.lesson.relationships.chapter.where).toEqual({
    course: { fromField: 'course' }
  })
  expect(contract.resources.lesson.relationships.creator.where).toEqual({
    role: { in: ['editor', 'admin'] }
  })

  const resolved = await sails.helpers.bridge.resolveRelationshipScope.with({
    resource: contract.resources.lesson,
    relationship: contract.resources.lesson.relationships.chapter,
    values: { course: courseId }
  })
  expect(resolved).toEqual({
    ready: true,
    missing: [],
    where: { course: courseId }
  })

  const unresolved = await sails.helpers.bridge.resolveRelationshipScope.with({
    resource: contract.resources.lesson,
    relationship: contract.resources.lesson.relationships.chapter,
    values: {}
  })
  expect(unresolved).toEqual({
    ready: false,
    missing: ['course'],
    where: {}
  })

  const precognitionValues =
    await sails.helpers.bridge.allowResourceValues.with({
      values: { course: courseId, chapter: 'chapter-1' },
      resource: contract.resources.lesson,
      surface: 'create',
      validateOnly: ['chapter']
    })
  expect(precognitionValues).toEqual({
    chapter: 'chapter-1',
    course: courseId
  })
})

test('Bridge rejects unsafe relationship scopes and dependency cycles', async ({
  sails,
  expect
}) => {
  const cases = [
    {
      where: { missing: 'admin' },
      message: 'references unavailable target field "missing"'
    },
    {
      where: { role: { fromField: 'missing' } },
      field: 'creator',
      message: 'references unavailable source field "missing"'
    },
    {
      where: { role: { not: 'admin' } },
      field: 'creator',
      message: 'must use only "fromField" or "in"'
    },
    {
      where: { course: { fromField: 'published' } },
      message: 'field types are incompatible'
    }
  ]

  for (const testCase of cases) {
    let error
    try {
      await sails.helpers.bridge.normalizeResourceContract.with({
        models: relationshipModelMetadata(),
        config: {
          resources: {
            lesson: {
              fields: {
                [testCase.field || 'chapter']: {
                  relation: { where: testCase.where }
                }
              }
            }
          }
        }
      })
    } catch (cause) {
      error = cause
    }
    expect(error.message).toContain(testCase.message)
  }

  let unavailableError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: relationshipModelMetadata(),
      config: {
        resources: {
          lesson: {
            create: ['title', 'chapter'],
            fields: {
              chapter: {
                relation: { where: { course: { fromField: 'course' } } }
              }
            }
          }
        }
      }
    })
  } catch (cause) {
    unavailableError = cause
  }
  expect(unavailableError.message).toContain(
    'depends on "course", which is unavailable on the create form'
  )

  let cycleError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: relationshipModelMetadata(),
      config: {
        resources: {
          lesson: {
            fields: {
              chapter: {
                relation: { where: { course: { fromField: 'course' } } }
              },
              course: {
                relation: { where: { id: { fromField: 'chapter' } } }
              }
            }
          }
        }
      }
    })
  } catch (cause) {
    cycleError = cause
  }
  expect(cycleError.message).toContain(
    'relationship dependencies contain a cycle'
  )
})

test('Bridge authorizes and verifies submitted belongs-to values', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: relationshipModelMetadata(),
    config: {}
  })
  const originalIntrospectModels = sails.helpers.bridge.introspectModels
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  const chapterId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80241'
  let missing = []

  try {
    sails.helpers.bridge.introspectModels = async () => ({
      schemaVersion: contract.schemaVersion,
      discover: contract.discover,
      configured: contract.configured,
      models: contract.resources
    })
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-app-web')
      expect(code).toContain('const missing = [];')
      const definitions = readEmbeddedValue(code, 'definitions')
      expect(definitions).toEqual([
        {
          alias: 'chapter',
          identity: 'chapter',
          primaryKey: 'id',
          id: chapterId,
          where: {},
          invalidMessage: 'Chapter no longer exists.'
        }
      ])
      return successfulResult({ missing })
    }

    const values = await sails.helpers.bridge.authorizeRelationshipValues.with({
      containerName: 'bridge-app-web',
      environmentId: 220,
      resource: contract.resources.lesson,
      actor: {
        id: '7',
        email: 'editor@example.com'
      },
      values: {
        title: 'A safe lesson',
        chapter: chapterId
      }
    })
    expect(values.chapter).toBe(chapterId)

    missing = ['chapter']
    let missingError
    try {
      await sails.helpers.bridge.authorizeRelationshipValues.with({
        containerName: 'bridge-app-web',
        environmentId: 220,
        resource: contract.resources.lesson,
        actor: {
          id: '7',
          email: 'editor@example.com'
        },
        values: {
          chapter: chapterId
        }
      })
    } catch (error) {
      missingError = error
    }
    expect(missingError.code).toBe('BRIDGE_RELATIONSHIP_NOT_FOUND')
    expect(missingError.fieldErrors).toEqual({
      chapter: 'Chapter no longer exists.'
    })
  } finally {
    sails.helpers.bridge.introspectModels = originalIntrospectModels
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge reapplies relationship scopes when authorizing mutations', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: relationshipModelMetadata(),
    config: {
      resources: {
        lesson: {
          fields: {
            chapter: {
              relation: { where: { course: { fromField: 'course' } } }
            },
            creator: {
              relation: { where: { role: 'admin' } }
            }
          }
        }
      }
    }
  })
  const originalIntrospectModels = sails.helpers.bridge.introspectModels
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  const values = {
    course: 'course-1',
    chapter: 'chapter-from-another-course',
    creator: 'student-1'
  }

  try {
    sails.helpers.bridge.introspectModels = async () => ({
      schemaVersion: contract.schemaVersion,
      discover: contract.discover,
      configured: contract.configured,
      models: contract.resources
    })
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (_containerName, code) => {
      const definitions = readEmbeddedValue(code, 'definitions')
      expect(
        definitions.find((definition) => definition.alias === 'chapter').where
      ).toEqual({ course: 'course-1' })
      expect(
        definitions.find((definition) => definition.alias === 'creator').where
      ).toEqual({ role: 'admin' })
      expect(code).toContain('{ and: [definition.where, identity] }')
      return successfulResult({ missing: ['chapter', 'creator'] })
    }

    let error
    try {
      await sails.helpers.bridge.authorizeRelationshipValues.with({
        containerName: 'bridge-app-web',
        environmentId: 220,
        resource: contract.resources.lesson,
        actor: { id: '7', email: 'editor@example.com' },
        values
      })
    } catch (cause) {
      error = cause
    }

    expect(error.code).toBe('BRIDGE_RELATIONSHIP_NOT_FOUND')
    expect(error.fieldErrors).toEqual({
      chapter: 'Chapter is not available for the selected course.',
      creator: 'Creator is not eligible for this field.'
    })
  } finally {
    sails.helpers.bridge.introspectModels = originalIntrospectModels
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge scopes initial and searched relationship options identically', async ({
  sails,
  expect
}) => {
  const courseId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80261'
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: relationshipModelMetadata(),
    config: {
      resources: {
        lesson: {
          fields: {
            chapter: {
              relation: {
                search: ['title'],
                where: { course: { fromField: 'course' } }
              }
            },
            creator: {
              relation: { where: { role: 'admin' } }
            }
          }
        }
      }
    }
  })
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  let searchDefinition
  let initialDefinitions

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (_containerName, code) => {
      if (code.includes('const definition = ')) {
        searchDefinition = readEmbeddedValue(code, 'definition')
        expect(code).toContain('{ and: [definition.where, textSearch] }')
        return successfulResult({
          options: [{ id: 'chapter-1', label: 'Scoped chapter' }],
          page: 1,
          limit: 20,
          hasMore: false
        })
      }
      initialDefinitions = readEmbeddedValue(code, 'definitions')
      return successfulResult({
        course: [],
        chapter: [{ id: 'chapter-1', label: 'Scoped chapter' }],
        creator: [{ id: 'admin-1', label: 'Ada Admin' }]
      })
    }

    const searched = await sails.helpers.bridge.searchRelationshipOptions.with({
      containerName: 'bridge-app-web',
      resources: contract.resources,
      resource: contract.resources.lesson,
      relationshipAlias: 'chapter',
      values: { course: courseId },
      search: 'scope'
    })
    expect(searched.options[0].label).toBe('Scoped chapter')
    expect(searchDefinition.where).toEqual({ course: courseId })

    const initial = await sails.helpers.bridge.loadAssociationOptions.with({
      containerName: 'bridge-app-web',
      resources: contract.resources,
      resource: contract.resources.lesson,
      surface: 'create',
      values: { course: courseId }
    })
    expect(initial.chapter[0].label).toBe('Scoped chapter')
    expect(
      initialDefinitions.find((definition) => definition.alias === 'chapter')
        .where
    ).toEqual({ course: courseId })
    expect(
      initialDefinitions.find((definition) => definition.alias === 'creator')
        .where
    ).toEqual({ role: 'admin' })

    let overrideError
    try {
      await sails.helpers.bridge.searchRelationshipOptions.with({
        containerName: 'bridge-app-web',
        resources: contract.resources,
        resource: contract.resources.lesson,
        relationshipAlias: 'creator',
        values: { role: 'student' }
      })
    } catch (cause) {
      overrideError = cause
    }
    expect(overrideError.code).toBe('BRIDGE_RELATIONSHIP_SCOPE_INVALID')
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
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

test('Bridge compiles type-aware filters and saved lenses into safe criteria', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          search: ['title'],
          list: ['title', 'published', 'creator', 'createdAt'],
          filters: ['title', 'published', 'creator', 'createdAt'],
          lenses: {
            published: {
              label: 'Published courses',
              filters: { published: true },
              columns: ['title', 'creator', 'published', 'createdAt'],
              sort: { field: 'createdAt', direction: 'DESC' },
              default: true
            },
            recent: {
              label: 'Recent courses',
              columns: ['title', 'createdAt'],
              sort: { field: 'createdAt', direction: 'DESC' },
              helper: 'bridge.lenses.recentCourses'
            }
          }
        }
      }
    }
  })
  const resource = contract.resources.course

  expect(resource.filterDefinitions.title.type).toBe('text')
  expect(resource.filterDefinitions.published.type).toBe('boolean')
  expect(resource.filterDefinitions.creator.type).toBe('belongsTo')
  expect(resource.filterDefinitions.createdAt.type).toBe('timestamp')
  expect(resource.lenses.published.filters).toEqual({
    published: { operator: 'equals', value: true }
  })
  expect(resource.lenses.recent.helper).toBe('bridge.lenses.recentCourses')

  const query = await sails.helpers.bridge.normalizeResourceQuery.with({
    resource,
    page: 2,
    perPage: 25,
    lens: 'published',
    search: 'Sails',
    filters: JSON.stringify({
      title: { operator: 'contains', value: 'production' },
      creator: { operator: 'equals', value: '42' },
      createdAt: {
        operator: 'between',
        from: '2026-07-01T00:00',
        to: '2026-07-31T23:59'
      }
    })
  })

  expect(query.lens.id).toBe('published')
  expect(query.columns).toEqual(['title', 'creator', 'published', 'createdAt'])
  expect(query.sort).toBe('createdAt DESC')
  expect(query.select).toEqual([
    'id',
    'title',
    'creator',
    'published',
    'createdAt'
  ])
  expect(query.where).toEqual({
    and: [
      { or: [{ title: { contains: 'Sails' } }] },
      { published: true },
      {
        and: [
          { title: { contains: 'production' } },
          { creator: 42 },
          {
            createdAt: {
              '>=': Date.parse('2026-07-01T00:00'),
              '<=': Date.parse('2026-07-31T23:59') + 59_999
            }
          }
        ]
      }
    ]
  })
  expect(query.criteria.skip).toBe(25)
})

test('Bridge filters preserve false values and support null checks', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          filters: ['published', 'description']
        }
      }
    }
  })
  const resource = contract.resources.course
  const query = await sails.helpers.bridge.normalizeResourceQuery.with({
    resource,
    filters: {
      published: { operator: 'equals', value: false },
      description: { operator: 'isNotNull' }
    }
  })

  expect(query.filters).toEqual({
    published: { operator: 'equals', value: false },
    description: { operator: 'isNotNull' }
  })
  expect(query.where).toEqual({
    and: [{ published: false }, { description: { '!=': null } }]
  })
})

test('Bridge rejects forged filters and invalid lens configuration', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          filters: ['published']
        }
      }
    }
  })
  let forgedFilterError
  let invalidLensError

  try {
    await sails.helpers.bridge.normalizeResourceQuery.with({
      resource: contract.resources.course,
      filters: {
        password: { operator: 'equals', value: 'secret' }
      }
    })
  } catch (error) {
    forgedFilterError = error
  }

  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        resources: {
          course: {
            filters: ['published'],
            lenses: {
              unsafe: {
                filters: { password: 'secret' }
              }
            }
          }
        }
      }
    })
  } catch (error) {
    invalidLensError = error
  }

  expect(forgedFilterError.code).toBe('BRIDGE_FILTER_INVALID')
  expect(forgedFilterError.message).toBe(
    'Bridge filter "password" is unavailable.'
  )
  expect(invalidLensError.code).toBe('BRIDGE_FILTER_INVALID')
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

test('Bridge hides sensitive fields by default and honors per-surface visibility', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: sensitiveModelMetadata(),
    config: {
      resources: {
        user: {
          fields: {
            emailChangeCandidate: {
              visibility: {
                show: true
              }
            },
            internalNote: {
              sensitive: true,
              visibility: {
                edit: true
              }
            }
          }
        }
      }
    }
  })
  const user = contract.resources.user

  expect(user.list).toEqual(['id', 'email', 'fullName', 'postalCode'])
  expect(user.show).toEqual([
    'id',
    'fullName',
    'email',
    'emailChangeCandidate',
    'postalCode'
  ])
  expect(user.create).toEqual(['fullName', 'email', 'postalCode'])
  expect(user.edit).toEqual(['fullName', 'email', 'internalNote', 'postalCode'])
  expect(user.search).toEqual(['fullName', 'email', 'postalCode'])
  expect(user.attributes.githubAccessToken.sensitive).toBe(true)
  expect(user.attributes.planCode.sensitive).toBe(true)
  expect(user.attributes.subscriptionCode.sensitive).toBe(true)
  expect(user.attributes.postalCode.sensitive).toBe(false)

  const redactedList = await sails.helpers.bridge.redactResourceRecords.with({
    records: [
      {
        id: 7,
        fullName: 'Editor',
        email: 'editor@example.com',
        postalCode: '101001',
        githubAccessToken: 'gho_secret',
        planCode: 'enterprise',
        unexpected: 'serializer leak'
      }
    ],
    resource: user,
    surface: 'list'
  })
  expect(redactedList).toEqual([
    {
      id: 7,
      fullName: 'Editor',
      email: 'editor@example.com',
      postalCode: '101001'
    }
  ])

  let forgedFieldError
  try {
    await sails.helpers.bridge.allowResourceValues.with({
      resource: user,
      surface: 'edit',
      values: {
        fullName: 'Forged editor',
        githubAccessToken: 'gho_forged'
      }
    })
  } catch (error) {
    forgedFieldError = error
  }

  expect(forgedFieldError.code).toBe('BRIDGE_FIELD_NOT_ALLOWED')
  expect(forgedFieldError.fields).toEqual(['githubAccessToken'])
})

test('Bridge resolves target app action authorization and fails closed', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      resources: {
        course: {
          authorization: 'bridge.authorize',
          actions: {
            publish: true
          }
        }
      }
    }
  })
  const originalIntrospectModels = sails.helpers.bridge.introspectModels
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  const targetAuthorize = async ({ actor, action }) => {
    if (!['editor', 'admin'].includes(actor.targetRole)) return false
    if (['update', 'delete', 'bulkDelete', 'publish'].includes(action)) {
      return actor.targetRole === 'admin'
    }
    return true
  }
  targetAuthorize.with = targetAuthorize

  try {
    sails.helpers.bridge.introspectModels = async () => ({
      schemaVersion: contract.schemaVersion,
      discover: contract.discover,
      configured: contract.configured,
      models: contract.resources
    })
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-app-web')
      const run = new Function('sails', `return (async () => {${code}})();`)
      const output = await run({
        helpers: {
          bridge: {
            authorize: targetAuthorize
          }
        }
      })
      return successfulResult(output)
    }

    const editorResources =
      await sails.helpers.bridge.authorizeResourceActions.with({
        containerName: 'bridge-app-web',
        resources: contract.resources,
        actor: {
          id: '7',
          email: 'editor@example.com',
          targetRole: 'editor'
        }
      })
    expect(editorResources.course.actions.viewAny).toBe(true)
    expect(editorResources.course.actions.view).toBe(true)
    expect(editorResources.course.actions.create).toBe(true)
    expect(editorResources.course.actions.update).toBe(false)
    expect(editorResources.course.actions.delete).toBe(false)
    expect(editorResources.course.actions.publish).toBe(false)

    const adminResources =
      await sails.helpers.bridge.authorizeResourceActions.with({
        containerName: 'bridge-app-web',
        resources: contract.resources,
        actor: {
          id: '8',
          email: 'admin@example.com',
          targetRole: 'admin'
        },
        recordId: 42
      })
    expect(adminResources.course.actions.update).toBe(true)
    expect(adminResources.course.actions.delete).toBe(true)
    expect(adminResources.course.actions.publish).toBe(true)

    let deniedUpdateError
    try {
      await sails.helpers.bridge.loadResource.with({
        containerName: 'bridge-app-web',
        environmentId: 218,
        modelIdentity: 'course',
        action: 'update',
        actor: {
          id: '7',
          email: 'editor@example.com',
          targetRole: 'editor'
        },
        recordId: '42'
      })
    } catch (error) {
      deniedUpdateError = error
    }
    expect(deniedUpdateError.code).toBe('BRIDGE_ACTION_NOT_ALLOWED')
  } finally {
    sails.helpers.bridge.introspectModels = originalIntrospectModels
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge declarative roles use one stable-ID lookup and deny unknown roles', async ({
  sails,
  expect
}) => {
  const models = modelMetadata()
  models.user.attributes.role = {
    type: 'string',
    isIn: ['user', 'editor', 'admin']
  }
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models,
    config: {
      discover: false,
      authorization: {
        roleAttribute: 'role',
        roles: {
          admin: ['*'],
          editor: ['viewAny', 'view', 'create']
        },
        default: []
      },
      resources: {
        course: {
          actions: { publish: true }
        },
        user: {
          authorization: {
            roles: {
              admin: ['viewAny'],
              editor: []
            }
          }
        }
      }
    }
  })
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  let role = 'editor'
  let queryCount = 0

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-app-web')
      const run = new Function('sails', `return (async () => {${code}})();`)
      const output = await run({
        models: {
          user: {
            findOne: async (criteria) => {
              queryCount += 1
              expect(criteria).toEqual({ id: '7' })
              return { id: 7, role }
            }
          }
        },
        helpers: {}
      })
      return successfulResult(output)
    }

    const editorResources =
      await sails.helpers.bridge.authorizeResourceActions.with({
        containerName: 'bridge-app-web',
        resources: contract.resources,
        actor: {
          id: '7',
          email: 'forged-address-does-not-drive-authorization@example.com'
        }
      })
    expect(queryCount).toBe(1)
    expect(editorResources.course.actions.viewAny).toBe(true)
    expect(editorResources.course.actions.create).toBe(true)
    expect(editorResources.course.actions.update).toBe(false)
    expect(editorResources.course.actions.publish).toBe(false)
    expect(editorResources.user.actions.viewAny).toBe(false)

    role = 'unknown'
    queryCount = 0
    const unknownResources =
      await sails.helpers.bridge.authorizeResourceActions.with({
        containerName: 'bridge-app-web',
        resources: contract.resources,
        actor: { id: '7', email: 'editor@example.com' }
      })
    expect(queryCount).toBe(1)
    expect(unknownResources.course.actions.viewAny).toBe(false)
    expect(unknownResources.course.actions.create).toBe(false)
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }

  let invalidConfiguration
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config: {
        authorization: {
          roles: {
            editor: ['publsih']
          }
        }
      }
    })
  } catch (error) {
    invalidConfiguration = error
  }
  expect(invalidConfiguration.message).toContain('unknown action "publsih"')
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

function relationshipModelMetadata() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'course',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string', required: true, isUUID: true },
        title: { type: 'string', required: true }
      },
      associations: [
        {
          alias: 'chapters',
          type: 'collection',
          collection: 'chapter',
          via: 'course'
        },
        {
          alias: 'lessons',
          type: 'collection',
          collection: 'lesson',
          via: 'course'
        }
      ]
    },
    chapter: {
      identity: 'chapter',
      globalId: 'Chapter',
      tableName: 'chapter',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string', required: true, isUUID: true },
        title: { type: 'string', required: true },
        internalNotes: { type: 'string', protect: true },
        course: { type: 'string', model: 'course' }
      },
      associations: [
        {
          alias: 'course',
          type: 'model',
          model: 'course'
        }
      ]
    },
    lesson: {
      identity: 'lesson',
      globalId: 'Lesson',
      tableName: 'lesson',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string', required: true, isUUID: true },
        title: { type: 'string', required: true },
        chapter: { type: 'string', model: 'chapter' },
        course: { type: 'string', model: 'course' },
        creator: { type: 'string', model: 'user' },
        published: { type: 'boolean', defaultsTo: false }
      },
      associations: [
        { alias: 'chapter', type: 'model', model: 'chapter' },
        { alias: 'course', type: 'model', model: 'course' },
        { alias: 'creator', type: 'model', model: 'user' }
      ]
    },
    user: {
      identity: 'user',
      globalId: 'User',
      tableName: 'user',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string', required: true, isUUID: true },
        fullName: { type: 'string', required: true },
        role: {
          type: 'string',
          isIn: ['student', 'editor', 'admin'],
          defaultsTo: 'student'
        }
      },
      associations: []
    }
  }
}

function sensitiveModelMetadata() {
  return {
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
        },
        email: {
          type: 'string',
          required: true,
          isEmail: true
        },
        githubAccessToken: {
          type: 'string'
        },
        emailChangeCandidate: {
          type: 'string'
        },
        planCode: {
          type: 'string'
        },
        subscriptionCode: {
          type: 'string'
        },
        password: {
          type: 'string',
          encrypt: true
        },
        internalNote: {
          type: 'string'
        },
        postalCode: {
          type: 'string'
        }
      },
      associations: []
    }
  }
}

function successfulResult(output) {
  return {
    success: true,
    output: JSON.stringify(output),
    error: null,
    exitCode: 0
  }
}

function readEmbeddedValue(code, name) {
  const match = code.match(new RegExp(`const ${name} = (.*);`))
  if (!match) throw new Error(`Missing ${name} declaration in Bridge query.`)
  return JSON.parse(match[1])
}
