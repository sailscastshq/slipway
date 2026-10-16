const { test } = require('sounding')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'project detail reuses loaded records for custom, wildcard and fallback domains',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'project-domain-reads',
          name: 'Project domains'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const project = world.current.projects.deploymentTarget
    const production = world.current.environments.production
    await sails.models.environment
      .updateOne({ id: production.id })
      .set({ domain: 'custom.example.com' })
    const staging = await world
      .create('environment')
      .with({ project: project.id, slug: 'staging' })
    for (let i = 0; i < 48; i++)
      await world
        .create('environment')
        .with({ project: project.id, slug: `review-${i}` })
    const foreignTeam = await world
      .create('team')
      .with({ name: 'Other team', owner: world.current.users.genesisUser.id })
    const foreignProject = await world.create('project').with({
      team: foreignTeam.id,
      createdBy: world.current.users.genesisUser.id
    })
    const cookie = await createSessionCookie(sails, {
      userId: world.current.users.genesisUser.id
    })
    const browser = await withCsrfFromPage(request.withHeaders({ cookie }), '/')
    await sails.helpers.setting.set('wildcardDomain', 'apps.example.com')
    const originalEnvironmentFind = sails.models.environment.findOne
    const originalProjectFind = sails.models.project.findOne
    const originalSlipwayDomain = sails.config.custom.slipwayDomain
    let environmentReads = 0
    let projectReads = 0
    sails.models.environment.findOne = function (...args) {
      environmentReads++
      return originalEnvironmentFind.apply(this, args)
    }
    sails.models.project.findOne = function (...args) {
      projectReads++
      return originalProjectFind.apply(this, args)
    }
    try {
      const response = await browser.request.get(`/projects/${project.slug}`)
      expect(response).toBeInertiaPage('projects/show')
      expect(response.data.props.environments.length).toBe(50)
      expect(environmentReads).toBe(0)
      expect(projectReads).toBe(1)
      expect(
        response.data.props.environments.find(
          (item) => item.id === production.id
        ).fullDomain
      ).toBe('custom.example.com')
      expect(
        response.data.props.environments.find((item) => item.id === staging.id)
          .fullDomain
      ).toBe(`${project.slug}-staging.apps.example.com`)
      expect(response).toHaveInertiaProp('deploymentHistory')
      expect(
        response.data.props.environments.find(
          (item) => item.id === production.id
        ).app.id
      ).toBe(world.current.apps.web.id)
      await sails.helpers.setting.set('wildcardDomain', '')
      sails.config.custom.slipwayDomain = 'slipway.example.com'
      const refreshed = await browser.request.get(`/projects/${project.slug}`)
      expect(
        refreshed.data.props.environments.find((item) => item.id === staging.id)
          .fullDomain
      ).toBe(`${project.slug}-staging.slipway.example.com`)
      sails.config.custom.slipwayDomain = null
      const withoutFallback = await browser.request.get(
        `/projects/${project.slug}`
      )
      expect(
        withoutFallback.data.props.environments.find(
          (item) => item.id === staging.id
        ).fullDomain
      ).toBe(null)
      const denied = await browser.request.get(
        `/projects/${foreignProject.slug}`
      )
      expect(denied).toRedirectTo('/')
    } finally {
      sails.models.environment.findOne = originalEnvironmentFind
      sails.models.project.findOne = originalProjectFind
      sails.config.custom.slipwayDomain = originalSlipwayDomain
    }
  }
)
