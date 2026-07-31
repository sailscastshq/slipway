const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge validates generated fields without creating a target record',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-precognition',
          name: 'Bridge Precognition'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const originalIntrospectModels = sails.helpers.bridge.introspectModels
    const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
    let validationExecutions = 0
    let mutationExecutions = 0

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: {
        subscriber: {
          identity: 'subscriber',
          globalId: 'Subscriber',
          tableName: 'subscriber',
          primaryKey: 'id',
          attributes: {
            id: { type: 'number', autoIncrement: true },
            name: { type: 'string', required: true },
            email: {
              type: 'string',
              required: true,
              isEmail: true,
              unique: true
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
        containerName: 'bridge-precognition-web'
      })
      sails.helpers.bridge.introspectModels = async () => ({
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources
      })
      sails.helpers.bridge.executeInContainer = async (
        _containerName,
        code
      ) => {
        if (code.includes('const fieldErrors = {};')) {
          validationExecutions += 1
          return successfulResult({
            fieldErrors: code.includes('taken@example.com')
              ? { email: 'Email is already in use.' }
              : {}
          })
        }
        if (
          code.includes('model.create') ||
          code.includes('model.update') ||
          code.includes('model.destroy')
        ) {
          mutationExecutions += 1
        }
        return {
          success: false,
          output: '',
          error: 'A Precognition request must not mutate the target app.',
          exitCode: 1
        }
      }

      const basePath = `/projects/${project.slug}/environments/${environment.slug}/bridge/subscriber`
      const browser = await withCsrfFromPage(
        request,
        `${basePath}/new`,
        'genesisUser'
      )
      const precognitive = browser.request.withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'values.email'
      })

      const invalid = await precognitive.post(`${basePath}/create`, {
        values: { email: 'taken@example.com' }
      })
      expect(invalid).toHaveStatus(422)
      expect(invalid.data.errors['values.email'][0]).toContain(
        'Email is already in use'
      )

      const valid = await precognitive.post(`${basePath}/create`, {
        values: { email: 'available@example.com' }
      })
      expect(valid).toHaveStatus(204)
      expect(valid).toHaveHeader('precognition-success', 'true')
      expect(validationExecutions).toBe(2)
      expect(mutationExecutions).toBe(0)
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
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
