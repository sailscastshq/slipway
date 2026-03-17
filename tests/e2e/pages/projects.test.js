const { test } = require('sounding')

const INERTIA_HEADERS = {
  'x-inertia': 'true',
  'x-requested-with': 'XMLHttpRequest',
  accept: 'text/html, application/xhtml+xml',
}

test('genesis user can open the new project page', async ({ sails, expect }) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const response = await sails.sounding.request
    .as(current.users.genesisUser)
    .withHeaders(INERTIA_HEADERS)
    .get('/projects/new')

  expect(response).toHaveStatus(200)
  expect(response).toBeInertiaPage('projects/new')
})

test('genesis user can create a project, environment, and app', async ({ sails, expect }) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const request = sails.sounding.request.as(current.users.genesisUser)
  const inertia = request.withHeaders(INERTIA_HEADERS)

  const createProject = await request.post('/projects', {
    name: 'Launch Pad',
    description: 'Critical path app',
  })

  expect(createProject).toHaveStatus(302)
  expect(createProject).toRedirectTo('/projects/launch-pad')

  const project = await sails.models.project.findOne({ slug: 'launch-pad' })
  expect(Boolean(project)).toBe(true)
  expect(project.team).toBe(current.teams.genesisTeam.id)

  const production = await sails.models.environment.findOne({
    project: project.id,
    slug: 'production',
  })
  expect(Boolean(production)).toBe(true)
  expect(production.isProduction).toBe(true)

  const createEnvironment = await request.post('/projects/launch-pad/environments', {
    name: 'Staging',
  })

  expect(createEnvironment).toHaveStatus(302)
  expect(createEnvironment).toRedirectTo('/projects/launch-pad')

  const staging = await sails.models.environment.findOne({
    project: project.id,
    slug: 'staging',
  })
  expect(Boolean(staging)).toBe(true)
  expect(staging.isProduction).toBe(false)

  const createApp = await request.post('/projects/launch-pad/environments/staging/apps', {
    name: 'Web',
    dockerfilePath: 'Dockerfile',
    routePath: '/',
  })

  expect(createApp).toHaveStatus(302)
  expect(createApp).toRedirectTo('/projects/launch-pad/environments/staging')

  const app = await sails.models.app.findOne({
    environment: staging.id,
    slug: 'web',
  })
  expect(Boolean(app)).toBe(true)
  expect(app.name).toBe('Web')
  expect(app.isDefault).toBe(true)

  const environmentPage = await inertia.get('/projects/launch-pad/environments/staging')
  expect(environmentPage).toHaveStatus(200)
  expect(environmentPage).toBeInertiaPage('projects/environment')
  expect(environmentPage).toHaveProp('environment.slug', 'staging')
  expect(environmentPage).toHaveProp('app.slug', 'web')
})
