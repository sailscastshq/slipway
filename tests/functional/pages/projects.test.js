const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'genesis user can open the new project page',
  { world: 'configured-slipway' },
  async ({ visit, expect }) => {
    const response = await visit.as('genesisUser')('/projects/new')

    expect(response).toHaveStatus(200)
    expect(response).toBeInertiaPage('projects/new')
  }
)

test(
  'genesis user can create a project, environment, and app',
  { world: 'configured-slipway' },
  async ({ sails, world, request, visit, expect }) => {
    const current = world.current
    const dashboard = await withCsrfFromPage(
      request,
      '/projects/new',
      'genesisUser'
    )

    const createProject = await dashboard.request.post('/projects', {
      name: 'Launch Pad',
      description: 'Critical path app'
    })

    expect(createProject).toHaveStatus(302)
    expect(createProject).toRedirectTo('/projects/launch-pad')

    const project = await sails.models.project.findOne({ slug: 'launch-pad' })
    expect(Boolean(project)).toBe(true)
    expect(project.team).toBe(current.teams.genesisTeam.id)

    const production = await sails.models.environment.findOne({
      project: project.id,
      slug: 'production'
    })
    expect(Boolean(production)).toBe(true)
    expect(production.isProduction).toBe(true)

    const createEnvironment = await dashboard.request.post(
      '/projects/launch-pad/environments',
      {
        name: 'Staging'
      }
    )

    expect(createEnvironment).toHaveStatus(302)
    expect(createEnvironment).toRedirectTo('/projects/launch-pad')

    const staging = await sails.models.environment.findOne({
      project: project.id,
      slug: 'staging'
    })
    expect(Boolean(staging)).toBe(true)
    expect(staging.isProduction).toBe(false)

    const createApp = await dashboard.request.post(
      '/projects/launch-pad/environments/staging/apps',
      {
        name: 'Web',
        dockerfilePath: 'Dockerfile',
        routePath: '/'
      }
    )

    expect(createApp).toHaveStatus(302)
    expect(createApp).toRedirectTo('/projects/launch-pad/environments/staging')

    const app = await sails.models.app.findOne({
      environment: staging.id,
      slug: 'web'
    })
    expect(Boolean(app)).toBe(true)
    expect(app.name).toBe('Web')
    expect(app.isDefault).toBe(true)

    const environmentPage = await visit.as('genesisUser')(
      '/projects/launch-pad/environments/staging'
    )
    expect(environmentPage).toHaveStatus(200)
    expect(environmentPage).toBeInertiaPage('projects/environment')
    expect(environmentPage).toHaveInertiaProp('environment.slug', 'staging')
    expect(environmentPage).toHaveInertiaProp('app.slug', 'web')
  }
)

test(
  'project creation validates with Precognition without creating records',
  { world: 'configured-slipway' },
  async ({ sails, request, expect }) => {
    const dashboard = await withCsrfFromPage(
      request,
      '/projects/new',
      'genesisUser'
    )
    const projectsBefore = await sails.models.project.count()
    const environmentsBefore = await sails.models.environment.count()

    const invalid = await dashboard.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'name'
      })
      .post('/projects', {
        name: '---',
        description: ''
      })

    expect(invalid).toHaveStatus(422)
    expect(Boolean(invalid.data.errors.name)).toBe(true)

    const valid = await dashboard.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'name'
      })
      .post('/projects', {
        name: 'Precognitive Launch',
        description: ''
      })

    expect(valid).toHaveStatus(204)
    expect(valid).toHaveHeader('precognition-success', 'true')
    expect(await sails.models.project.count()).toBe(projectsBefore)
    expect(await sails.models.environment.count()).toBe(environmentsBefore)
  }
)

test(
  'app settings validate with Precognition without changing the app',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'precognition-configuration',
          name: 'Precognition Configuration'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const dashboard = await withCsrfFromPage(request, '/', 'genesisUser')
    const url = `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`

    const invalid = await dashboard.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'resourceLimits.cpus'
      })
      .patch(url, {
        resourceLimits: { cpus: '0', memory: '512m' }
      })

    expect(invalid).toHaveStatus(422)
    expect(Boolean(invalid.data.errors['resourceLimits.cpus'])).toBe(true)

    const valid = await dashboard.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'resourceLimits.memory'
      })
      .patch(url, {
        resourceLimits: { cpus: '1', memory: '1g' }
      })

    expect(valid).toHaveStatus(204)
    expect(valid).toHaveHeader('precognition-success', 'true')

    const unchanged = await sails.models.app.findOne({ id: app.id })
    expect(unchanged.resourceLimits).toEqual(app.resourceLimits)
  }
)

test(
  'app page uses the custom domain as the primary URL',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'custom-domain-priority',
          name: 'Custom Domain Priority'
        }
      }
    }
  },
  async ({ sails, world, visit, expect }) => {
    const current = world.current
    await sails.models.environment
      .updateOne({ id: current.environments.production.id })
      .set({ domain: 'app.example.com' })

    const page = await visit.as('genesisUser')(
      `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/apps/${current.apps.web.slug}`
    )

    expect(page).toHaveStatus(200)
    expect(page).toBeInertiaPage('projects/app')
    expect(page).toHaveInertiaProp('app.primaryUrl', 'https://app.example.com')
    expect(page).toHaveInertiaProp(
      'app.accessUrls.0.value',
      'https://app.example.com'
    )
    expect(page).toHaveInertiaProp('app.accessUrls.0.kind', 'custom')
    expect(page).toHaveInertiaProp('app.accessUrls.1.kind', 'generated')
  }
)

test(
  'deployment history sorts before limiting and uses a stable cursor',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'ordered-history',
          name: 'Ordered History'
        }
      }
    }
  },
  async ({ sails, world, visit, expect }) => {
    const current = world.current
    const environment = current.environments.production
    const app = current.apps.web
    const baseTime = Date.now() - 100000

    for (let index = 0; index < 27; index += 1) {
      await world.create('deployment').with({
        status: 'stopped',
        environment: environment.id,
        app: app.id,
        gitMessage: `Release ${String(index).padStart(2, '0')}`,
        createdAt: baseTime + index * 1000,
        startedAt: baseTime + index * 1000,
        finishedAt: baseTime + index * 1000 + 500
      })
    }

    const tiedAt = baseTime + 200000
    const firstTie = await world.create('deployment').with({
      // Legacy successful releases can remain `running` after traffic moves on.
      // The App pointer, not this lifecycle value, owns the user-facing outcome.
      status: 'running',
      environment: environment.id,
      app: app.id,
      gitMessage: 'Tie A',
      createdAt: tiedAt,
      startedAt: tiedAt,
      finishedAt: tiedAt + 500
    })
    const secondTie = await world.create('deployment').with({
      status: 'running',
      environment: environment.id,
      app: app.id,
      gitMessage: 'Tie B',
      createdAt: tiedAt,
      startedAt: tiedAt,
      finishedAt: tiedAt + 500
    })

    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'running',
      currentDeployment: secondTie.id,
      lastDeployedAt: tiedAt
    })

    const firstPage = await visit.as('genesisUser')(
      `/projects/${current.projects.deploymentTarget.slug}`
    )
    expect(firstPage).toHaveStatus(200)
    expect(firstPage).toHaveInertiaPropCount('deploymentHistory.items', 25)
    expect(firstPage).toHaveInertiaProp(
      'deploymentHistory.items.0.id',
      secondTie.id
    )
    expect(firstPage).toHaveInertiaProp(
      'deploymentHistory.items.1.id',
      firstTie.id
    )
    expect(firstPage).toHaveInertiaProp(
      'deploymentHistory.items.0.outcomeLabel',
      'Current'
    )
    expect(firstPage).toHaveInertiaProp(
      'deploymentHistory.items.1.outcomeLabel',
      'Succeeded'
    )
    expect(firstPage).toHaveInertiaProp(
      'deploymentHistory.items.0.isCurrent',
      true
    )
    expect(firstPage).toHaveInertiaProp(
      'deploymentHistory.items.1.isCurrent',
      false
    )
    expect(firstPage).toHaveInertiaProp(
      'deploymentHistory.currentReleases.0.id',
      secondTie.id
    )

    const firstItems = firstPage.data.props.deploymentHistory.items
    const cursor = firstPage.data.props.deploymentHistory.nextCursor
    expect(Boolean(cursor)).toBe(true)

    const secondPage = await visit.as('genesisUser')(
      `/projects/${
        current.projects.deploymentTarget.slug
      }?deploymentCursor=${encodeURIComponent(cursor)}`
    )
    expect(secondPage).toHaveStatus(200)
    expect(secondPage).toHaveInertiaPropCount('deploymentHistory.items', 4)
    expect(secondPage).toHaveInertiaProp(
      'deploymentHistory.items.0.title',
      'Release 03'
    )
    expect(secondPage).toHaveInertiaProp(
      'deploymentHistory.items.3.title',
      'Release 00'
    )

    const firstIds = new Set(firstItems.map((deployment) => deployment.id))
    const secondItems = secondPage.data.props.deploymentHistory.items
    expect(secondItems.some((deployment) => firstIds.has(deployment.id))).toBe(
      false
    )
  }
)

test(
  'deployment history filters outcomes and sources without hiding active work',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'filtered-history',
          name: 'Filtered History'
        }
      }
    }
  },
  async ({ world, visit, expect }) => {
    const current = world.current
    const target = {
      environment: current.environments.production.id,
      app: current.apps.web.id
    }

    const failure = await world.create('deployment').with({
      ...target,
      status: 'failed',
      triggerType: 'cli',
      gitMessage: 'Broken CLI release',
      finishedAt: Date.now()
    })
    await world.create('deployment').with({
      ...target,
      status: 'stopped',
      triggerType: 'webhook',
      gitMessage: 'Successful Git release',
      finishedAt: Date.now()
    })
    const active = await world.create('deployment').with({
      ...target,
      status: 'pushing',
      triggerType: 'manual',
      gitMessage: 'Publishing release'
    })

    const page = await visit.as('genesisUser')(
      `/projects/${current.projects.deploymentTarget.slug}?deploymentStatus=failed&deploymentSource=cli`
    )

    expect(page).toHaveStatus(200)
    expect(page).toHaveInertiaPropCount('deploymentHistory.items', 1)
    expect(page).toHaveInertiaProp('deploymentHistory.items.0.id', failure.id)
    expect(page).toHaveInertiaProp('deploymentHistory.filters.status', 'failed')
    expect(page).toHaveInertiaProp('deploymentHistory.filters.source', 'cli')
    expect(page).toHaveInertiaProp(
      'deploymentHistory.activeDeployments.0.id',
      active.id
    )
    expect(page).toHaveInertiaProp(
      'deploymentHistory.activeDeployments.0.outcomeLabel',
      'Publishing'
    )
  }
)
