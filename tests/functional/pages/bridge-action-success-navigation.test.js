const { test } = require('sounding')
const { setup } = require('../../support/bridge-conditional-actions')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'record action success returns to the list only after confirmed removal',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'action-navigation' } }
    }
  },
  async ({ sails, request, world, expect }) => {
    const state = await setup(sails, world)
    const base =
      '/projects/action-navigation/environments/production/bridge/submission'
    const path = `${base}/actions/send-decision`
    const browser = await withCsrfFromPage(
      request,
      '/projects/new',
      'genesisUser'
    )
    const client = request
      .as('genesisUser')
      .withHeaders({ accept: 'application/json' })
    try {
      for (const kind of [
        'ordinary',
        'spoofed',
        'pending',
        'probe-failure',
        'removed',
        'failed'
      ]) {
        state.records[1] = {
          id: 1,
          title: 'Fixture document',
          status: 'accepted'
        }
        state.readFailure = false
        const context = await client.get(`${path}/context?recordId=1`)
        expect(context).toHaveStatus(200)
        state.onDecision = () => {
          if (kind === 'failed') throw new Error('Private provider failure')
          if (kind === 'removed' || kind === 'pending') delete state.records[1]
          if (kind === 'probe-failure') state.readFailure = true
          return {
            message: 'Completed.',
            cleanupPending: kind === 'pending',
            recordRemoved: true,
            redirect: 'https://untrusted.invalid'
          }
        }
        const response = await browser.request.post(path, {
          recordId: 1,
          conditionToken: context.data.conditionToken,
          recordRemoved: true,
          redirect: 'https://untrusted.invalid'
        })
        if (kind === 'failed') {
          expect(response).toHaveStatus(303)
          expect(response).toHaveHeader('x-exit', 'badRequest')
          expect(
            JSON.stringify(response.session.errors).includes('Private provider')
          ).toBe(false)
        } else {
          expect(response).toHaveStatus(302)
          expect(response).toHaveHeader(
            'location',
            kind === 'removed' ? base : `${base}/1`
          )
          expect(response.session._inertiaFlash.success).toBe('Completed.')
        }
      }
      expect(state.calls.length).toBe(6)
    } finally {
      state.restore()
    }
  }
)
