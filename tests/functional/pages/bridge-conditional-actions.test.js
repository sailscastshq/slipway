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
      const accepted = await post(1, context.conditionToken, {
        acceptanceMessage: 'Welcome',
        reason: 'injected hidden input'
      })
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

      state.records[1].status = 'rejected'
      const stale = await post(1, context.conditionToken, {
        acceptanceMessage: 'Welcome'
      })
      expect(stale).toHaveStatus(303)
      expect(stale.session.errors.error[0]).toContain('Reopen')
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
      state.changeBeforeExecution = true
      const race = await post(1, beforeRace.conditionToken, {})
      expect(race).toHaveStatus(303)
      expect(race.session.errors.error[0]).toContain('Reopen')
      expect(state.calls.length).toBe(2)
    } finally {
      state.restore()
    }
  }
)
