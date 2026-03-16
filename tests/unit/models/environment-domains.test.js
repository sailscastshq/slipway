const { afterEach, describe, it } = require('node:test')
const assert = require('node:assert/strict')

const environmentModel = require('../../../api/models/Environment')
const generateRouteConfig = require('../../../api/helpers/caddy/generate-route-config')

const originalGlobals = {
  sails: global.sails,
  Environment: global.Environment,
  App: global.App
}

function withQueryResult(record) {
  return {
    populate: async () => record
  }
}

function mockEnvironmentModel(environmentRecord, { wildcardDomain = null, slipwayDomain = 'localhost' } = {}) {
  global.sails = {
    helpers: {
      setting: {
        get: async (key) => (key === 'wildcardDomain' ? wildcardDomain : null)
      }
    },
    config: {
      custom: {
        slipwayDomain
      }
    }
  }

  global.Environment = {
    ...environmentModel,
    findOne: () => withQueryResult(environmentRecord)
  }

  return global.Environment
}

afterEach(() => {
  global.sails = originalGlobals.sails
  global.Environment = originalGlobals.Environment
  global.App = originalGlobals.App
})

describe('Environment domain resolution', () => {
  it('uses generated hostname as the primary domain when no custom domain is set', async () => {
    const Environment = mockEnvironmentModel(
      {
        id: 'env-1',
        slug: 'production',
        domain: null,
        project: { slug: 'my-app' }
      },
      { wildcardDomain: 'apps.example.com' }
    )

    const resolved = await Environment.resolveDomains('env-1')

    assert.deepEqual(resolved, {
      fullDomain: 'my-app-production.apps.example.com',
      generatedDomain: 'my-app-production.apps.example.com',
      domains: ['my-app-production.apps.example.com']
    })
  })

  it('keeps the generated hostname as a fallback when a custom domain is present', async () => {
    const Environment = mockEnvironmentModel(
      {
        id: 'env-2',
        slug: 'production',
        domain: 'app.example.com',
        project: { slug: 'my-app' }
      },
      { wildcardDomain: 'apps.example.com' }
    )

    const resolved = await Environment.resolveDomains('env-2')

    assert.deepEqual(resolved, {
      fullDomain: 'app.example.com',
      generatedDomain: 'my-app-production.apps.example.com',
      domains: ['app.example.com', 'my-app-production.apps.example.com']
    })
  })

  it('returns no hostname routes when neither wildcard nor slipwayDomain is available', async () => {
    const Environment = mockEnvironmentModel(
      {
        id: 'env-3',
        slug: 'production',
        domain: null,
        project: { slug: 'my-app' }
      },
      { wildcardDomain: null, slipwayDomain: null }
    )

    const resolved = await Environment.resolveDomains('env-3')

    assert.deepEqual(resolved, {
      fullDomain: null,
      generatedDomain: null,
      domains: []
    })
  })
})

describe('Caddy route generation', () => {
  it('matches both the custom and generated hostnames when both exist', async () => {
    mockEnvironmentModel(
      {
        id: 'env-4',
        slug: 'production',
        domain: 'app.example.com',
        project: { slug: 'my-app' }
      },
      { wildcardDomain: 'apps.example.com' }
    )

    global.App = {
      find: async () => [
        {
          hostPort: 1388,
          routePath: '/',
          port: 1337
        }
      ]
    }

    const config = await generateRouteConfig.fn({ environmentId: 'env-4' })

    assert.equal(config.domain, 'app.example.com')
    assert.deepEqual(config.domains, ['app.example.com', 'my-app-production.apps.example.com'])
    assert.deepEqual(config.route.match[0].host, ['app.example.com', 'my-app-production.apps.example.com'])
  })
})
