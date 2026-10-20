const { test } = require('sounding')
const assert = require('node:assert/strict')
const { setup } = require('../../support/bridge-conditional-actions')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge flashes media previews only for authorized app-host actions',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'media-authority' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const state = await setup(sails, world)
    const originalResolve = sails.helpers.bridge.resolveRequest,
      flash = sails.inertia.flash
    let native = false
    const captures = []
    sails.helpers.bridge.resolveRequest = {
      with: async (args) => ({
        ...(await originalResolve.with(args)),
        bridgeHostOrigin: native
      })
    }
    sails.inertia.flash = function (...args) {
      captures.push(args)
      return flash.apply(this, args)
    }
    state.contract.resources.proposal.actionDefinitions.sendDecision.fields = {}
    delete state.contract.resources.proposal.actionDefinitions.sendDecision
      .visibleWhen
    state.target.helpers.bridge.decision = {
      with: async () => ({
        preview: {
          type: 'video',
          title: 'Recording',
          url: '/api/talk-assets/asset-1/preview'
        }
      })
    }
    const path =
      '/projects/media-authority/environments/production/bridge/submission/actions/send-decision'
    try {
      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      expect(
        await browser.request.post(path, { recordId: '1', values: {} })
      ).toHaveStatus(303)
      assert(!captures.some(([key]) => key === 'bridgeActionPreview'))
      native = true
      expect(
        await browser.request.post(path, { recordId: '1', values: {} })
      ).toHaveStatus(302)
      assert.equal(
        captures.find(([key]) => key === 'bridgeActionPreview')[1].url,
        '/api/talk-assets/asset-1/preview'
      )
      state.denied = true
      const count = captures.filter(
        ([key]) => key === 'bridgeActionPreview'
      ).length
      expect(
        await browser.request.post(path, { recordId: '1', values: {} })
      ).toHaveStatus(303)
      assert.equal(
        captures.filter(([key]) => key === 'bridgeActionPreview').length,
        count
      )
    } finally {
      sails.inertia.flash = flash
      state.restore()
    }
  }
)
