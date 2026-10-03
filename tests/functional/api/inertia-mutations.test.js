const { test } = require('sounding')
const crypto = require('node:crypto')
const { withCsrfFromPage } = require('../../support/csrf-request')
test(
  'page and REST configuration mutations share validation, authorization, and persistence',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'inertia-contract' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const app = world.current.apps.web
    const env = world.current.environments.production
    const path = '/projects/inertia-contract/environments/production'
    const browser = await withCsrfFromPage(
      request.using('virtual'),
      path,
      'genesisUser'
    )
    const page = browser.request.withHeaders({ referer: path })
    const token = crypto.randomBytes(32).toString('hex')
    await sails.models.clitoken.create({
      user: world.current.users.genesisUser.id,
      team: world.current.teams.genesisTeam.id,
      token: crypto.createHash('sha256').update(token).digest('hex')
    })
    const rest = request.using('http').withHeaders({
      authorization: `Bearer sl_${token}`,
      accept: 'application/json'
    })
    const service = await world
      .create('service')
      .with({ name: 'Contract db', environment: env.id, status: 'stopped' })
    for (const [url, body, model, id] of [
      [
        `/api/v1${path}/apps/${app.slug}`,
        { name: 'Web from page' },
        'app',
        app.id
      ],
      [
        `/api/v1${path}`,
        { name: 'Environment from page' },
        'environment',
        env.id
      ],
      [
        `/api/v1/services/${service.id}`,
        { name: 'Database from page' },
        'service',
        service.id
      ]
    ]) {
      const saved = await page.patch(url, body)
      expect(saved).toHaveStatus(303)
      expect(saved).toHaveHeader('location', path)
      expect((await sails.models[model].findOne({ id })).name).toBe(body.name)
      const invalid = await page.patch(url, { name: '' })
      expect(invalid).toHaveStatus(303)
      expect((await sails.models[model].findOne({ id })).name).toBe(body.name)
      const json = await rest.patch(url, { name: 'REST saved' })
      expect(json).toHaveStatus(200)
      expect(JSON.stringify(json.data).includes('REST saved')).toBe(true)
      const rejected = await rest.patch(url, { name: '' })
      expect(rejected).toHaveStatus(400)
    }
    const vars = await rest.patch(`/api/v1${path}/apps/${app.slug}`, {
      envVars: { PRIVATE: 'fixture-secret' },
      envVarMetadata: { PRIVATE: { kind: 'secret', previewPolicy: 'omit' } }
    })
    expect(vars).toHaveStatus(200)
    expect(JSON.stringify(vars.data).includes('fixture-secret')).toBe(false)
    const unauth = await request.patch(`/api/v1${path}/apps/${app.slug}`, {
      name: 'forbidden'
    })
    expect([401, 403, 302, 303].includes(unauth.status)).toBe(true)
  }
)

test(
  'CLI token rename and revoke return the registered token page',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const browser = await withCsrfFromPage(
      request,
      '/settings/cli-tokens',
      'genesisUser'
    )
    const token = await sails.models.clitoken
      .create({
        user: world.current.users.genesisUser.id,
        token: crypto.randomBytes(32).toString('hex'),
        name: 'Old name'
      })
      .fetch()
    const renamed = await browser.request.patch(
      `/settings/cli-tokens/${token.id}`,
      { name: 'New name' }
    )
    expect(renamed).toHaveStatus(303)
    expect(renamed).toHaveHeader('location', '/settings/cli-tokens')
    expect((await sails.models.clitoken.findOne({ id: token.id })).name).toBe(
      'New name'
    )
    const revoked = await browser.request.delete(
      `/settings/cli-tokens/${token.id}`
    )
    expect(revoked).toHaveStatus(303)
    expect(revoked).toHaveHeader('location', '/settings/cli-tokens')
    expect(await sails.models.clitoken.findOne({ id: token.id })).toBe(
      undefined
    )
  }
)
