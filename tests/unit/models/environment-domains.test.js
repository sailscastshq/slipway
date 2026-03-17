const { test } = require('sounding')

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

function mockEnvironmentModel(
  environmentRecord,
  { wildcardDomain = null, slipwayDomain = 'localhost' } = {}
) {
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

function restoreGlobals() {
  global.sails = originalGlobals.sails
  global.Environment = originalGlobals.Environment
  global.App = originalGlobals.App
}

test('environment uses the generated hostname as the primary domain when no custom domain is set', async ({
  expect
}) => {
  try {
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

    expect(resolved).toEqual({
      fullDomain: 'my-app-production.apps.example.com',
      generatedDomain: 'my-app-production.apps.example.com',
      domains: ['my-app-production.apps.example.com']
    })
  } finally {
    restoreGlobals()
  }
})

test('environment keeps the generated hostname as a fallback when a custom domain is present', async ({
  expect
}) => {
  try {
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

    expect(resolved).toEqual({
      fullDomain: 'app.example.com',
      generatedDomain: 'my-app-production.apps.example.com',
      domains: ['app.example.com', 'my-app-production.apps.example.com']
    })
  } finally {
    restoreGlobals()
  }
})

test('environment returns no hostname routes when neither wildcard nor slipwayDomain is available', async ({
  expect
}) => {
  try {
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

    expect(resolved).toEqual({
      fullDomain: null,
      generatedDomain: null,
      domains: []
    })
  } finally {
    restoreGlobals()
  }
})

test('caddy route generation matches both the custom and generated hostnames when both exist', async ({
  expect
}) => {
  try {
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

    expect(config.domain).toBe('app.example.com')
    expect(config.domains).toEqual([
      'app.example.com',
      'my-app-production.apps.example.com'
    ])
    expect(config.route.match[0].host).toEqual([
      'app.example.com',
      'my-app-production.apps.example.com'
    ])
  } finally {
    restoreGlobals()
  }
})
