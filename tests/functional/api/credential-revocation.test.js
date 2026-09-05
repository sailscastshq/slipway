const crypto = require('node:crypto')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'HTTP bearer requests cannot mint a browser login or survive token revocation',
  { transport: 'http', world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const raw = crypto.randomBytes(32).toString('hex')
    const token = await sails.models.clitoken
      .create({
        token: crypto.createHash('sha256').update(raw).digest('hex'),
        user: world.current.users.genesisUser.id,
        name: 'Revocation test'
      })
      .fetch()
    const bearer = request.withHeaders({ authorization: `Bearer sl_${raw}` })
    const created = await bearer.post('/api/v1/projects', {
      name: 'Bearer project'
    })
    expect(created).toHaveStatus(201)

    // Same HTTP request context without Authorization must remain a guest.
    expect(await request.get('/api/v1/projects')).toHaveStatus(401)
    await sails.models.clitoken.destroyOne({ id: token.id })
    expect(await bearer.get('/api/v1/projects')).toHaveStatus(401)
    expect(await request.get('/api/v1/projects')).toHaveStatus(401)
  }
)

test(
  'invalid bearer credentials cannot fall back to a signed-in browser session',
  { world: 'configured-slipway' },
  async ({ request, expect }) => {
    const browser = await withCsrfFromPage(request, '/settings', 'genesisUser')
    const response = await browser.request
      .withHeaders({
        authorization: 'Bearer invalid'
      })
      .post('/api/v1/projects', { name: 'Must not be created' })
    expect(response).toHaveStatus(401)
  }
)

test(
  'deleted users cannot use existing browser identity or dangling CLI tokens',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const id = world.current.users.genesisUser.id
    const browser = await withCsrfFromPage(request, '/settings', 'genesisUser')
    await sails.models.team.destroyOne({
      id: world.current.teams.genesisTeam.id
    })
    await sails.models.user.destroyOne({ id })
    expect(await browser.request.get('/api/v1/projects')).toHaveStatus(401)
    expect(
      await browser.request.post('/api/v1/bosun/eval', { code: '1+1' })
    ).toHaveStatus(401)
  }
)
