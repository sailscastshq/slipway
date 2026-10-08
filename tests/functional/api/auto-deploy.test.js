const { test } = require('sounding')
const crypto = require('node:crypto')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'auto-deploy repairs the existing inactive hook, preserves failed preferences and routes signed pushes to its app',
  { transport: 'http', world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const project = await world.create('project').with({
      slug: 'repair-webhook',
      team: current.teams.genesisTeam.id,
      createdBy: current.users.genesisUser.id
    })
    const environment = await world
      .create('environment')
      .trait('production')
      .with({ project: project.id })
    const app = await world
      .create('app')
      .trait('configured')
      .with({ environment: environment.id })
    const provider = await world
      .create('gitprovider')
      .with({ team: current.teams.genesisTeam.id })
    const secret = 'repair-webhook-signature'
    const repository = await world.create('gitrepository').with({
      externalId: '738',
      provider: provider.id,
      environment: environment.id,
      app: app.id,
      autoDeploy: true,
      webhookId: '99',
      webhookUrl: 'https://slipway.test/webhook/github',
      webhookSecret: secret
    })
    const originalFetch = global.fetch
    const originalQueue = sails.helpers.deploy.queueDeployment
    let active = false
    let status = 200
    const methods = []
    const queued = []
    global.fetch = async (url, options = {}) => {
      if (!String(url).startsWith('https://api.github.com/'))
        return originalFetch(url, options)
      methods.push(options.method || 'GET')
      if (status !== 200) return new Response('', { status })
      if (options.method === 'PATCH') {
        const body = JSON.parse(options.body)
        expect(body.config.secret).toBe(secret)
        expect(body.events).toEqual(['push'])
        active = body.active
      }
      return Response.json({
        id: 99,
        active,
        events: ['push'],
        config: { url: repository.webhookUrl, content_type: 'json' },
        last_response: { code: 200 }
      })
    }
    sails.helpers.deploy.queueDeployment = {
      with: async (input) => {
        queued.push(input)
        return { deployment: { id: 738 } }
      }
    }
    const base = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
    try {
      const cookie = await createSessionCookie(sails, {
        userId: current.users.genesisUser.id
      })
      const session = await withCsrfFromPage(
        request.withHeaders({ cookie }),
        `${base}/settings`
      )
      expect(session.page.data.props.connectedRepo.webhook.status).toBe(
        'inactive'
      )
      for (const autoDeploy of [true, true, false, true]) {
        const response = await session.request.patch(`${base}/repo`, {
          autoDeploy
        })
        expect(response).toHaveStatus(303)
        expect(
          (await sails.models.gitrepository.findOne(repository.id)).autoDeploy
        ).toBe(autoDeploy)
      }
      expect(active).toBe(true)
      expect(methods.includes('POST')).toBe(false)
      expect(
        (await session.request.get(`${base}/settings`)).data.props.connectedRepo
          .webhook.status
      ).toBe('ready')
      await session.request.patch(`${base}/repo`, { autoDeploy: false })
      for (const failure of [403, 404, 503]) {
        status = failure
        await session.request.patch(`${base}/repo`, { autoDeploy: true })
        expect(
          (await sails.models.gitrepository.findOne(repository.id)).autoDeploy
        ).toBe(false)
        expect(
          (await session.request.get(`${base}/settings`)).data.props
            .connectedRepo.webhook.status === 'ready'
        ).toBe(false)
      }
      status = 200
      await session.request.patch(`${base}/repo`, { autoDeploy: true })
      const payload = {
        ref: 'refs/heads/main',
        after: 'a'.repeat(40),
        repository: { id: 738 },
        head_commit: { message: 'Deploy after repair' }
      }
      const raw = JSON.stringify(payload)
      const push = await request
        .withHeaders({
          'content-type': 'application/json',
          'x-github-event': 'push',
          'x-github-delivery': 'after-webhook-repair',
          'x-hub-signature-256': `sha256=${crypto
            .createHmac('sha256', secret)
            .update(raw)
            .digest('hex')}`
        })
        .post('/webhook/github', raw)
      expect(push).toHaveStatus(200)
      expect(push.data.action).toBe('deployment_queued')
      expect(queued.length).toBe(1)
      expect(queued[0].app.id).toBe(app.id)
      expect(queued[0].values.gitBranch).toBe('main')
      expect(queued[0].values.environment).toBe(environment.id)
    } finally {
      global.fetch = originalFetch
      sails.helpers.deploy.queueDeployment = originalQueue
    }
  }
)
