const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'app and environment partial reloads skip deployment history work',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'inertia-partial-performance',
          name: 'Inertia partial performance'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const { deploymentTarget } = world.current.projects
    const { production } = world.current.environments
    const { web } = world.current.apps
    const browser = await withCsrfFromPage(request, '/', 'genesisUser')
    const environmentUrl = `/projects/${deploymentTarget.slug}/environments/${production.slug}`
    const appUrl = `${environmentUrl}/apps/${web.slug}`
    const originalGetHistory = sails.helpers.deployment.getHistory
    let historyCalls = 0

    const trackedGetHistory = (...args) => originalGetHistory(...args)
    trackedGetHistory.with = (...args) => {
      historyCalls += 1
      return originalGetHistory.with(...args)
    }
    sails.helpers.deployment.getHistory = trackedGetHistory

    try {
      const appPage = await browser.request.get(appUrl)
      expect(appPage).toHaveStatus(200)
      expect(appPage).toHaveInertiaProp('deploymentHistory')
      expect(historyCalls).toBe(1)

      const appRefresh = await browser.request.get(appUrl, {
        headers: {
          'X-Inertia': 'true',
          'X-Inertia-Partial-Component': 'projects/app',
          'X-Inertia-Partial-Data': 'readiness'
        }
      })
      expect(appRefresh).toHaveStatus(200)
      expect(appRefresh).toHaveInertiaProp('readiness')
      expect(appRefresh.data.props.deploymentHistory).toBe(undefined)
      expect(historyCalls).toBe(1)

      const appOnly = await browser.request.get(appUrl, {
        headers: {
          'X-Inertia': 'true',
          'X-Inertia-Partial-Component': 'projects/app',
          'X-Inertia-Partial-Data': 'app'
        }
      })
      expect(appOnly).toHaveStatus(200)
      expect(appOnly).toHaveInertiaProp('app.slug', web.slug)
      expect(historyCalls).toBe(1)

      const environmentPage = await browser.request.get(environmentUrl)
      expect(environmentPage).toHaveStatus(200)
      expect(environmentPage).toHaveInertiaProp('deploymentHistory')
      expect(historyCalls).toBe(2)

      const environmentRefresh = await browser.request.get(environmentUrl, {
        headers: {
          'X-Inertia': 'true',
          'X-Inertia-Partial-Component': 'projects/environment',
          'X-Inertia-Partial-Data': 'readiness'
        }
      })
      expect(environmentRefresh).toHaveStatus(200)
      expect(environmentRefresh).toHaveInertiaProp('readiness')
      expect(environmentRefresh.data.props.deploymentHistory).toBe(undefined)
      expect(historyCalls).toBe(2)

      const environmentOnly = await browser.request.get(environmentUrl, {
        headers: {
          'X-Inertia': 'true',
          'X-Inertia-Partial-Component': 'projects/environment',
          'X-Inertia-Partial-Data': 'environment'
        }
      })
      expect(environmentOnly).toHaveStatus(200)
      expect(environmentOnly).toHaveInertiaProp(
        'environment.slug',
        production.slug
      )
      expect(historyCalls).toBe(2)
    } finally {
      sails.helpers.deployment.getHistory = originalGetHistory
    }
  }
)
