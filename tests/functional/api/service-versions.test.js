const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'authenticated clients can discover the tested service version matrix',
  { world: 'configured-slipway' },
  async ({ request, expect }) => {
    const response = await request
      .as('genesisUser')
      .get('/api/v1/service-versions')

    expect(response).toHaveStatus(200)
    expect(response).toHaveJsonPath('services.postgresql.defaultVersion', '17')
    expect(response).toHaveJsonPath('services.mysql.defaultVersion', '8.4')
    expect(response).toHaveJsonPath('services.redis.defaultVersion', '7.2')
    expect(response).toHaveJsonPath('services.mongodb.defaultVersion', '8.0')
  }
)

test(
  'service creation persists the tested default and rejects latest',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'service-defaults',
          name: 'Service Defaults'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const originalCreate = sails.helpers.docker.createService
    const markRunning = async (serviceId) => {
      await sails.models.service.updateOne({ id: serviceId }).set({
        status: 'running',
        containerId: 'test-service-container',
        imageReference: 'postgres@sha256:test-default'
      })
      return { containerId: 'test-service-container' }
    }
    sails.helpers.docker.createService = markRunning

    try {
      const dashboard = await withCsrfFromPage(
        request,
        '/projects/service-defaults/environments/production',
        'genesisUser'
      )
      const client = dashboard.request
      const url =
        '/api/v1/projects/service-defaults/environments/production/services'
      const created = await client.post(url, {
        name: 'main-db',
        type: 'postgresql'
      })

      expect(created).toHaveStatus(201)
      expect(created).toHaveJsonPath('service.version', '17')
      expect(created).toHaveJsonPath('service.versionSupport', 'supported')

      const persisted = await sails.models.service.findOne({
        environment: world.current.environments.production.id,
        name: 'main-db'
      })
      expect(persisted.version).toBe('17')

      const mutable = await client.post(url, {
        name: 'mutable-db',
        type: 'postgresql',
        version: 'latest'
      })
      expect(mutable).toHaveStatus(303)
      expect(mutable).toHaveHeader('x-exit', 'badRequest')
    } finally {
      sails.helpers.docker.createService = originalCreate
    }
  }
)
