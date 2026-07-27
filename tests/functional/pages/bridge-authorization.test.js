const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge rejects a forged sensitive field before target app execution',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-forged-sensitive-field',
          name: 'Bridge forged sensitive field'
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
    const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
    let executionCount = 0

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: {
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
            }
          },
          associations: []
        }
      },
      config: {}
    })

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        status: 'running',
        containerName: 'bridge-forged-sensitive-field-web'
      })
      sails.helpers.bridge.introspectModels = async () => ({
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources
      })
      sails.helpers.bridge.executeInContainer = async () => {
        executionCount += 1
        return {
          success: false,
          output: '',
          error: 'A rejected payload must not reach the target app.',
          exitCode: 1
        }
      }

      const createPath = `/projects/${project.slug}/environments/${environment.slug}/bridge/user/new`
      const createRecordPath = `/projects/${project.slug}/environments/${environment.slug}/bridge/user/create`
      const browser = await withCsrfFromPage(request, createPath, 'genesisUser')
      const response = await browser.request.post(createRecordPath, {
        values: {
          fullName: 'Forged administrator',
          email: 'forged@example.com',
          githubAccessToken: 'gho_forged'
        }
      })

      expect(response).toHaveStatus(400)
      expect(response).toHaveHeader('x-exit', 'badRequest')
      expect(executionCount).toBe(0)
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)
