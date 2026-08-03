const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge table partial reloads skip unchanged dashboard work',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-partial-performance',
          name: 'Bridge partial performance'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const originalIntrospectModels = sails.helpers.bridge.introspectModels
    const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
    const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: {
        resources: {
          course: {
            list: ['title', 'published'],
            search: ['title']
          }
        },
        dashboards: {
          courseHealth: {
            scope: 'resource',
            resource: 'course',
            cards: {
              published: {
                type: 'metric',
                resource: 'course',
                where: { published: true }
              }
            }
          }
        }
      }
    })
    let dashboardExecutions = 0
    let queryExecutions = 0

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        status: 'running',
        containerName: 'bridge-partial-performance-web'
      })
      sails.helpers.bridge.introspectModels = async () => ({
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources,
        dashboards: contract.dashboards
      })
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (containerName, code) => {
        expect(containerName).toBe('bridge-partial-performance-web')
        if (code.includes('const decisions = Object.create(null);')) {
          const requests = readEmbeddedValue(code, 'requests')
          const decisions = {}
          for (const authorizationRequest of requests) {
            decisions[authorizationRequest.key] =
              decisions[authorizationRequest.key] || {}
            decisions[authorizationRequest.key][
              authorizationRequest.action
            ] = true
          }
          return successfulResult(decisions)
        }
        if (code.includes('const dashboard =')) {
          dashboardExecutions += 1
          return successfulResult([{ id: 'published', value: 1 }])
        }
        if (code.includes('const total = await model.count(where);')) {
          queryExecutions += 1
          return successfulResult({
            records: [{ id: 1, title: 'Durable UI', published: true }],
            total: 1
          })
        }
        return failedResult('Unexpected Bridge performance query.')
      }

      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      const modelPath = `/projects/${project.slug}/environments/${environment.slug}/bridge/course`
      const initial = await browser.request.get(modelPath)

      expect(initial).toHaveStatus(200)
      expect(initial).toHaveInertiaProp('activeDashboard.cards.0.value', 1)
      expect(dashboardExecutions).toBe(1)
      expect(queryExecutions).toBe(1)

      const search = await browser.request.get(`${modelPath}?search=durable`, {
        headers: {
          'X-Inertia': 'true',
          'X-Inertia-Partial-Component': 'projects/bridge-model',
          'X-Inertia-Partial-Data':
            'records,total,totalPages,currentPage,search,error'
        }
      })

      expect(search).toHaveStatus(200)
      expect(search).toHaveInertiaProp('search', 'durable')
      expect(search.data.props.activeDashboard).toBe(undefined)
      expect(dashboardExecutions).toBe(1)
      expect(queryExecutions).toBe(2)
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)

function successfulResult(output) {
  return {
    success: true,
    output: JSON.stringify(output),
    error: null,
    exitCode: 0
  }
}

function failedResult(error) {
  return {
    success: false,
    output: '',
    error,
    exitCode: 1
  }
}

function readEmbeddedValue(code, name) {
  const match = code.match(new RegExp(`const ${name} = (.*);`))
  if (!match) throw new Error(`Missing ${name} declaration in Bridge query.`)
  return JSON.parse(match[1])
}

function modelMetadata() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'course',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        title: { type: 'string', required: true },
        published: { type: 'boolean', defaultsTo: false }
      },
      associations: []
    }
  }
}
