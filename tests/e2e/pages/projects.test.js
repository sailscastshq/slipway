const assert = require('node:assert/strict')
const { test } = require('sounding')

const INERTIA_HEADERS = {
  'x-inertia': 'true',
  'x-requested-with': 'XMLHttpRequest',
  accept: 'text/html, application/xhtml+xml',
}

test('configured owner can open the new project page', async ({ sails, expect }) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const response = await sails.sounding.request
    .as(current.users.owner)
    .withHeaders(INERTIA_HEADERS)
    .get('/projects/new')

  expect(response).toHaveStatus(200)
  expect(response).toBeInertiaPage('projects/new')
})

test('configured owner can create a project, environment, and app', async ({ sails, expect }) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const request = sails.sounding.request.as(current.users.owner)
  const inertia = request.withHeaders(INERTIA_HEADERS)

  const createProject = await request.post('/projects', {
    name: 'Launch Pad',
    description: 'Critical path app',
  })

  expect(createProject).toHaveStatus(302)
  expect(createProject).toRedirectTo('/projects/launch-pad')

  const project = await sails.models.project.findOne({ slug: 'launch-pad' })
  assert.ok(project)
  assert.equal(project.team, current.teams.owner.id)

  const production = await sails.models.environment.findOne({
    project: project.id,
    slug: 'production',
  })
  assert.ok(production)
  assert.equal(production.isProduction, true)

  const createEnvironment = await request.post('/projects/launch-pad/environments', {
    name: 'Staging',
  })

  expect(createEnvironment).toHaveStatus(302)
  expect(createEnvironment).toRedirectTo('/projects/launch-pad')

  const staging = await sails.models.environment.findOne({
    project: project.id,
    slug: 'staging',
  })
  assert.ok(staging)
  assert.equal(staging.isProduction, false)

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
  assert.ok(app)
  assert.equal(app.name, 'Web')
  assert.equal(app.isDefault, true)

  const environmentPage = await inertia.get('/projects/launch-pad/environments/staging')
  expect(environmentPage).toHaveStatus(200)
  expect(environmentPage).toBeInertiaPage('projects/environment')
  expect(environmentPage).toHaveProp('environment.slug', 'staging')
  expect(environmentPage).toHaveProp('app.slug', 'web')
})
