const { test } = require('sounding')
const { setup } = require('../../support/bridge-conditional-actions')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge condition context and mutations enforce saved state, visible inputs and authorization',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'conditional-actions' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const state = await setup(sails, world)
    const base = '/projects/conditional-actions/environments/production/bridge'
    const actionPath = `${base}/submission/actions/send-decision`
    try {
      expect(
        await request
          .withHeaders({ accept: 'application/json' })
          .get(`${actionPath}/context?recordId=1`)
      ).toHaveStatus(401)
      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      const client = request
        .as('genesisUser')
        .withHeaders({ accept: 'application/json' })
      const contextFor = async (id) => {
        const response = await client.get(
          `${actionPath}/context?recordId=${id}`
        )
        expect(response).toHaveStatus(200)
        expect(response.header('cache-control')).toContain('no-store')
        return response.data
      }
      const context = await contextFor(1)
      expect(Object.keys(context.action.fields)).toEqual(['acceptanceMessage'])
      expect(JSON.stringify(context).includes('conditionRecord')).toBe(false)
      const post = (id, token, values = {}, path = actionPath) =>
        browser.request.post(path, {
          recordId: id,
          conditionToken: token,
          values
        })
      const realNow = Date.now
      Date.now = () => realNow() + 31 * 60 * 1000
      let accepted
      try {
        accepted = await post(1, context.conditionToken, {
          acceptanceMessage: 'Welcome',
          reason: 'injected hidden input'
        })
      } finally {
        Date.now = realNow
      }
      expect(accepted).toHaveStatus(302)
      expect(state.calls[0].values).toEqual({ acceptanceMessage: 'Welcome' })
      expect(state.calls[0].resource.identity).toBe('proposal')
      expect(
        state.authorizations.some((input) => input.action === 'sendDecision')
      ).toBe(true)

      const rejectedContext = await contextFor(2)
      expect(Object.keys(rejectedContext.action.fields)).toEqual(['reason'])
      const missing = await post(2, rejectedContext.conditionToken)
      expect(missing).toHaveStatus(303)
      expect(state.calls.length).toBe(1)
      const rejected = await post(
        2,
        rejectedContext.conditionToken,
        { reason: 'Not this year', acceptanceMessage: 'hidden' },
        `${base}/proposal/actions/sendDecision`
      )
      expect(rejected).toHaveStatus(302)
      expect(state.calls[1].values).toEqual({ reason: 'Not this year' })

      // Exercise conditional submission through an authenticated host-app session.
      const app = world.current.apps.web
      const environment = await sails.models.environment.findOne({
        id: app.environment
      })
      const project = await sails.models.project.findOne({
        id: environment.project
      })
      await sails.models.app
        .updateOne({ id: app.id })
        .set({ bridgeEnabled: true, routePath: '/' })
      await sails.models.environment
        .updateOne({ id: environment.id })
        .set({ domain: 'decision-host.example' })
      const secret = await sails.helpers.bridge.ensureAppSecret.with({
        appId: String(app.id),
        rotate: true
      })
      const access = await world.create('bridgeaccess').with({
        email: 'decision-editor@example.com',
        role: 'editor',
        status: 'active',
        hostUserId: 'decision-editor',
        activatedAt: Date.now(),
        app: app.id,
        environment: environment.id,
        project: project.id,
        team: world.current.teams.genesisTeam.id,
        invitedBy: world.current.users.genesisUser.id
      })
      const exchange = await request
        .withHeaders({
          authorization: `Bearer ${secret}`,
          accept: 'application/json'
        })
        .post('/api/v1/bridge/exchange', {
          appId: String(app.id),
          hostOrigin: true,
          hostUser: {
            id: access.hostUserId,
            email: access.email,
            fullName: 'Editor',
            emailVerified: true
          }
        })
      expect(exchange).toHaveStatus(201)
      const launch = await request.get(
        `/bridge/launch${new URL(exchange.data.launchUrl).search}`,
        {
          headers: {
            host: 'decision-host.example',
            'x-forwarded-host': 'decision-host.example'
          }
        }
      )
      expect(launch).toHaveStatus(302)
      const csrf = new (require('csrf'))()
      const csrfSecret = csrf.secretSync()
      const host = request
        .withSession({ ...launch.session, csrfSecret })
        .withHeaders({
          host: 'decision-host.example',
          'x-forwarded-host': 'decision-host.example',
          'x-csrf-token': csrf.create(csrfSecret)
        })
      const hostPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge/submission/actions/send-decision`
      const hostContext = await host
        .withHeaders({ accept: 'application/json' })
        .get(`${hostPath}/context?recordId=1`)
      expect(hostContext).toHaveStatus(200)
      const hostSent = await host.post(hostPath, {
        recordId: 1,
        conditionToken: hostContext.data.conditionToken,
        values: { acceptanceMessage: 'Hosted decision' }
      })
      expect(hostSent).toHaveStatus(302)
      expect(state.calls.pop().actor.source).toBe('host-app')

      state.records[1].status = 'rejected'
      const stale = await post(1, context.conditionToken, {
        acceptanceMessage: 'Welcome'
      })
      expect(stale).toHaveStatus(303)
      expect(stale.session.errors.error[0]).toContain('status changed')
      const forged = await post(1, context.conditionToken + 'bad', {
        reason: 'Rejected'
      })
      expect(forged).toHaveStatus(303)
      const absent = await post(1, undefined, { reason: 'Rejected' })
      expect(absent).toHaveStatus(303)
      const wrongRecord = await post(1, rejectedContext.conditionToken, {
        reason: 'Rejected'
      })
      expect(wrongRecord).toHaveStatus(303)
      expect(state.calls.length).toBe(2)

      state.records[1].status = 'accepted'
      const beforeDenied = await contextFor(1)
      state.denied = true
      expect(await client.get(`${actionPath}/context?recordId=1`)).toHaveStatus(
        409
      )
      expect(await post(1, beforeDenied.conditionToken, {})).toHaveStatus(303)
      state.denied = false
      state.denyView = true
      expect(await client.get(`${actionPath}/context?recordId=1`)).toHaveStatus(
        409
      )
      state.denyView = false
      state.records[1].status = 'draft'
      expect(await client.get(`${actionPath}/context?recordId=1`)).toHaveStatus(
        409
      )
      expect(await post(1, beforeDenied.conditionToken, {})).toHaveStatus(303)
      state.records[1].status = 'accepted'
      const beforeRace = await contextFor(1)
      const definition =
        state.contract.resources.proposal.actionDefinitions.sendDecision
      const savedDefinition = JSON.parse(JSON.stringify(definition))
      delete definition.visibleWhen
      for (const field of Object.values(definition.fields))
        delete field.visibleWhen
      expect(await post(1, beforeRace.conditionToken, {})).toHaveStatus(303)
      Object.assign(definition, savedDefinition)
      state.readFailure = true
      const failedRead = await post(1, beforeRace.conditionToken, {})
      expect(failedRead).toHaveStatus(303)
      expect(failedRead.session.errors.error[0]).toContain(
        'Could not load the record'
      )
      expect(
        JSON.stringify(failedRead.session.errors).includes('Private database')
      ).toBe(false)
      state.readFailure = false
      const savedRecord = state.records[1]
      delete state.records[1]
      const missingRecord = await post(1, beforeRace.conditionToken, {})
      expect(missingRecord.session.errors.error[0]).toContain(
        'no longer exists'
      )
      state.records[1] = savedRecord
      state.changeBeforeExecution = true
      const race = await post(1, beforeRace.conditionToken, {})
      expect(race).toHaveStatus(303)
      expect(race.session.errors.error[0]).toContain('status changed')
      expect(state.calls.length).toBe(2)
    } finally {
      state.restore()
    }
  }
)
