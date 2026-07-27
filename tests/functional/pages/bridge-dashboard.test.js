const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge filters dashboard data and quick actions through target-app authorization',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-dashboard-authorization',
          name: 'Bridge dashboard authorization'
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
          user: {
            authorization: 'bridge.authorize'
          },
          course: {
            authorization: 'bridge.authorize'
          }
        },
        dashboard: {
          cards: {
            users: {
              type: 'metric',
              resource: 'user'
            },
            courses: {
              type: 'recent',
              resource: 'course',
              fields: ['title', 'createdAt']
            },
            newCourse: {
              type: 'action',
              resource: 'course'
            }
          }
        }
      }
    })

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        status: 'running',
        containerName: 'bridge-dashboard-authorization-web'
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
        expect(containerName).toBe('bridge-dashboard-authorization-web')
        if (code.includes('const decisions = Object.create(null);')) {
          const requests = readEmbeddedValue(code, 'requests')
          const decisions = {}
          for (const authorizationRequest of requests) {
            decisions[authorizationRequest.key] =
              decisions[authorizationRequest.key] || {}
            decisions[authorizationRequest.key][authorizationRequest.action] =
              authorizationRequest.key === 'course' &&
              authorizationRequest.action === 'viewAny'
          }
          return successfulResult(decisions)
        }
        if (code.includes('const dashboard =')) {
          const definitions = readEmbeddedValue(code, 'definitions')
          expect(definitions.map((definition) => definition.id)).toEqual([
            'courses'
          ])
          return successfulResult([
            {
              id: 'courses',
              records: [
                {
                  id: 11,
                  title: 'A safe dashboard',
                  createdAt: Date.UTC(2026, 6, 27, 8, 15)
                }
              ]
            }
          ])
        }
        if (code.includes('const counts = {};')) {
          return successfulResult({ course: 1 })
        }
        return failedResult('Unexpected Bridge dashboard query.')
      }

      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      const response = await browser.request.get(
        `/projects/${project.slug}/environments/${environment.slug}/bridge`
      )

      expect(response).toHaveStatus(200)
      expect(response).toHaveInertiaProp(
        'activeDashboard.cards.0.id',
        'courses'
      )
      expect(response).toHaveInertiaProp(
        'activeDashboard.cards.0.records.0.title',
        'A safe dashboard'
      )
      expect(response.data.props.models.user).toBe(undefined)
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
    user: model('user', 'User', {
      id: { type: 'number', autoIncrement: true },
      fullName: { type: 'string', required: true },
      createdAt: { type: 'number', autoCreatedAt: true }
    }),
    course: model('course', 'Course', {
      id: { type: 'number', autoIncrement: true },
      title: { type: 'string', required: true },
      createdAt: { type: 'number', autoCreatedAt: true }
    })
  }
}

function model(identity, globalId, attributes) {
  return {
    identity,
    globalId,
    tableName: identity,
    primaryKey: 'id',
    attributes,
    associations: []
  }
}
