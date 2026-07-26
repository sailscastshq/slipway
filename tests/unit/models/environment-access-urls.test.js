const { test } = require('sounding')

test(
  'app URLs keep custom, generated, and direct access in canonical order',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'canonical-app-urls',
          name: 'Canonical App URLs'
        }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const current = world.current
    const environment = await sails.models.environment
      .updateOne({ id: current.environments.production.id })
      .set({ domain: 'app.example.com' })

    const resolved = await sails.models.environment.resolveAppUrls(
      {
        ...environment,
        project: current.projects.deploymentTarget
      },
      {
        wildcardDomain: 'apps.example.com',
        slipwayDomain: null,
        directUrl: 'http://203.0.113.10:1340',
        directHint: 'Allow inbound TCP 1340.'
      }
    )

    expect(resolved.primaryUrl).toBe('https://app.example.com')
    expect(resolved.accessUrls).toEqual([
      {
        kind: 'custom',
        label: 'Custom',
        display: 'app.example.com',
        value: 'https://app.example.com',
        href: 'https://app.example.com',
        logLabel: 'URL'
      },
      {
        kind: 'generated',
        label: 'Generated',
        display: 'canonical-app-urls-production.apps.example.com',
        value: 'https://canonical-app-urls-production.apps.example.com',
        href: 'https://canonical-app-urls-production.apps.example.com',
        logLabel: 'Fallback'
      },
      {
        kind: 'direct',
        label: 'Direct',
        display: '203.0.113.10:1340',
        value: 'http://203.0.113.10:1340',
        href: 'http://203.0.113.10:1340',
        hint: 'Allow inbound TCP 1340.',
        logLabel: 'Direct'
      }
    ])
  }
)

test(
  'a verified direct URL becomes primary only when no domain is available',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'direct-url-fallback',
          name: 'Direct URL Fallback'
        }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const current = world.current
    const resolved = await sails.models.environment.resolveAppUrls(
      {
        ...current.environments.production,
        project: current.projects.deploymentTarget
      },
      {
        wildcardDomain: null,
        slipwayDomain: null,
        directUrl: 'http://203.0.113.10:1340'
      }
    )

    expect(resolved.primaryUrl).toBe('http://203.0.113.10:1340')
    expect(resolved.accessUrls.map((entry) => entry.kind)).toEqual(['direct'])
  }
)
