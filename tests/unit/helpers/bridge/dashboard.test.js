const { test } = require('sounding')

test('Bridge normalizes dashboard metrics, recent records, quick actions, and helper cards', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      dashboards: {
        overview: {
          label: 'Content overview',
          default: true,
          scope: 'environment',
          cards: {
            users: {
              type: 'metric',
              label: 'Total users',
              resource: 'user',
              aggregate: 'count'
            },
            courses: {
              type: 'metric',
              resource: 'course',
              aggregate: 'count',
              where: { published: true }
            },
            lessons: {
              type: 'recent',
              resource: 'lesson',
              fields: ['title', 'createdAt'],
              limit: 4
            },
            newCourse: {
              type: 'action',
              resource: 'course'
            },
            signups: {
              type: 'trend',
              resource: 'user',
              helper: 'bridge.dashboard.signups'
            }
          }
        }
      }
    }
  })

  const dashboard = contract.dashboards.overview
  expect(dashboard.label).toBe('Content overview')
  expect(dashboard.default).toBe(true)
  expect(dashboard.scope).toBe('environment')
  expect(dashboard.cards.map((card) => card.type)).toEqual([
    'metric',
    'metric',
    'recent',
    'action',
    'trend'
  ])
  expect(dashboard.cards[1].where).toEqual({ published: true })
  expect(dashboard.cards[2].fields).toEqual(['id', 'title', 'createdAt'])
  expect(dashboard.cards[3].label).toBe('New Course')
})

test('Bridge dashboard configuration fails closed for hidden resources and unsafe criteria', async ({
  sails,
  expect
}) => {
  let hiddenResourceError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        resources: {
          user: false
        },
        dashboard: {
          cards: {
            users: {
              type: 'metric',
              resource: 'user'
            }
          }
        }
      }
    })
  } catch (error) {
    hiddenResourceError = error
  }
  expect(hiddenResourceError.message).toContain(
    'cannot reference hidden resource "user"'
  )

  let unsafeCriteriaError
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        dashboard: {
          cards: {
            users: {
              type: 'metric',
              resource: 'user',
              where: {
                createdAt: {
                  '>': Number.POSITIVE_INFINITY
                }
              }
            }
          }
        }
      }
    })
  } catch (error) {
    unsafeCriteriaError = error
  }
  expect(unsafeCriteriaError.message).toContain(
    'must contain only serializable values'
  )
})

test('Bridge resolves count metrics and bounded recent records through Waterline', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      dashboard: {
        label: 'Overview',
        cards: {
          users: {
            type: 'metric',
            label: 'Total users',
            resource: 'user'
          },
          lessons: {
            type: 'recent',
            label: 'Recent lessons',
            resource: 'lesson',
            fields: ['title', 'createdAt'],
            limit: 2
          }
        }
      }
    }
  })
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-dashboard-web')
      expect(code).toContain('value = await model.count(definition.where)')
      expect(code).toContain('limit: definition.limit')

      const run = new Function('sails', `return (async () => {${code}})();`)
      const output = await run({
        models: {
          user: {
            count: async () => 128
          },
          lesson: {
            find: async (criteria) => {
              expect(criteria.limit).toBe(2)
              expect(criteria.sort).toBe('createdAt DESC')
              return [
                {
                  id: 7,
                  title: 'Deploy without surprises',
                  createdAt: Date.UTC(2026, 6, 26, 9, 15),
                  internalToken: 'must-not-leak'
                },
                {
                  id: 6,
                  title: 'Build a boring release',
                  createdAt: Date.UTC(2026, 6, 25, 16, 30),
                  internalToken: 'must-not-leak'
                }
              ]
            }
          }
        },
        helpers: {}
      })
      return successfulResult(output)
    }

    const dashboard = await sails.helpers.bridge.resolveDashboard.with({
      containerName: 'bridge-dashboard-web',
      dashboard: contract.dashboards.overview,
      resources: contract.resources,
      actor: {
        id: '1',
        email: 'admin@example.com',
        role: 'admin'
      }
    })

    expect(dashboard.cards[0].value).toBe(128)
    expect(dashboard.cards[1].records).toEqual([
      {
        id: 7,
        title: 'Deploy without surprises',
        createdAt: Date.UTC(2026, 6, 26, 9, 15)
      },
      {
        id: 6,
        title: 'Build a boring release',
        createdAt: Date.UTC(2026, 6, 25, 16, 30)
      }
    ])
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge removes dashboard cards when resource authorization denies their data or action', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: modelMetadata(),
    config: {
      dashboard: {
        cards: {
          users: {
            type: 'metric',
            resource: 'user'
          },
          lessons: {
            type: 'recent',
            resource: 'lesson'
          },
          newCourse: {
            type: 'action',
            resource: 'course'
          }
        }
      }
    }
  })
  const resources = JSON.parse(JSON.stringify(contract.resources))
  resources.user.actions.viewAny = false
  resources.course.actions.create = false
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer

  try {
    sails.helpers.bridge.executeInContainer = async () =>
      successfulResult([
        {
          id: 'lessons',
          records: []
        }
      ])

    const dashboard = await sails.helpers.bridge.resolveDashboard.with({
      containerName: 'bridge-dashboard-web',
      dashboard: contract.dashboards.overview,
      resources,
      actor: {
        id: '1',
        email: 'editor@example.com',
        role: 'editor'
      }
    })

    expect(dashboard.cards.map((card) => card.id)).toEqual(['lessons'])
  } finally {
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge resolves aggregate and helper-backed dashboard cards with bounded output', async ({
  sails,
  expect
}) => {
  const models = modelMetadata()
  models.course.attributes.price = { type: 'number', required: true }
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models,
    config: {
      resources: {
        course: {
          list: ['title', 'createdAt'],
          show: ['id', 'title', 'price', 'createdAt']
        }
      },
      dashboard: {
        cards: {
          revenue: {
            type: 'metric',
            resource: 'course',
            aggregate: 'sum',
            field: 'price',
            format: 'currency',
            currency: 'usd'
          },
          averagePrice: {
            type: 'metric',
            resource: 'course',
            aggregate: 'average',
            field: 'price'
          },
          highestPrice: {
            type: 'metric',
            resource: 'course',
            aggregate: 'max',
            field: 'price'
          },
          lowestPrice: {
            type: 'metric',
            resource: 'course',
            aggregate: 'min',
            field: 'price'
          },
          growth: {
            type: 'trend',
            resource: 'course',
            helper: 'bridge.dashboard.growth'
          },
          status: {
            type: 'partition',
            resource: 'course',
            helper: 'bridge.dashboard.status'
          },
          note: {
            type: 'custom',
            helper: 'bridge.dashboard.note'
          }
        }
      }
    }
  })
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (_containerName, code) => {
      const run = new Function('sails', `return (async () => {${code}})();`)
      const helper = (result) => ({ with: async () => result })
      const output = await run({
        models: {
          course: {
            sum: () => ({ where: async () => 9400 }),
            avg: () => ({ where: async () => 2350 }),
            find: async ({ sort }) =>
              sort === 'price DESC'
                ? [{ id: 1, price: 4900 }]
                : [{ id: 2, price: 900 }]
          }
        },
        helpers: {
          bridge: {
            dashboard: {
              growth: helper({
                points: Array.from({ length: 40 }, (_, index) => ({
                  label: `Day ${index + 1}`,
                  value: index
                }))
              }),
              status: helper({
                segments: [
                  { label: 'Published', value: 3 },
                  { label: 'Draft', value: 1 }
                ]
              }),
              note: helper({
                value: 'Healthy',
                detail: 'All content checks passed.'
              })
            }
          }
        }
      })
      return successfulResult(output)
    }

    const dashboard = await sails.helpers.bridge.resolveDashboard.with({
      containerName: 'bridge-dashboard-web',
      dashboard: contract.dashboards.overview,
      resources: contract.resources,
      actor: { id: '1', email: 'admin@example.com', role: 'admin' }
    })
    const results = Object.fromEntries(
      dashboard.cards.map((card) => [card.id, card])
    )

    expect(results.revenue.value).toBe(9400)
    expect(results.revenue.currency).toBe('USD')
    expect(results.averagePrice.value).toBe(2350)
    expect(results.highestPrice.value).toBe(4900)
    expect(results.lowestPrice.value).toBe(900)
    expect(results.growth.points.length).toBe(31)
    expect(results.status.segments).toEqual([
      { label: 'Published', value: 3 },
      { label: 'Draft', value: 1 }
    ])
    expect(results.note.value).toBe('Healthy')
    expect(results.note.detail).toBe('All content checks passed.')
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

function successfulResult(value) {
  return {
    success: true,
    output: JSON.stringify(value),
    error: null,
    exitCode: 0
  }
}

function modelMetadata() {
  return {
    user: model({
      identity: 'user',
      globalId: 'User',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        fullName: { type: 'string', required: true },
        email: { type: 'string', required: true, isEmail: true },
        createdAt: { type: 'number', autoCreatedAt: true }
      }
    }),
    course: model({
      identity: 'course',
      globalId: 'Course',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        title: { type: 'string', required: true },
        published: { type: 'boolean', defaultsTo: false },
        createdAt: { type: 'number', autoCreatedAt: true }
      }
    }),
    lesson: model({
      identity: 'lesson',
      globalId: 'Lesson',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        title: { type: 'string', required: true },
        createdAt: { type: 'number', autoCreatedAt: true },
        internalToken: { type: 'string', protect: true }
      }
    })
  }
}

function model({ identity, globalId, attributes }) {
  return {
    identity,
    globalId,
    tableName: identity,
    primaryKey: 'id',
    attributes,
    associations: []
  }
}
