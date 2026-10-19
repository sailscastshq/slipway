const { test } = require('sounding')
const { setup } = require('../../support/bridge-conditional-actions')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge action upload endpoints retain CSRF, action authorization and record-bound completion',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'upload-authority' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const state = await setup(sails, world)
    state.contract.resources.proposal.actionDefinitions.sendDecision.fields = {
      material: {
        type: 'string',
        required: true,
        label: 'Material',
        field: {
          type: 'file',
          upload: {
            kind: 'file',
            storage: 'bridge',
            scope: 'environment',
            directory: 'materials',
            filename: '',
            accept: ['application/pdf'],
            maxBytes: 10485760
          }
        }
      }
    }
    const storage = sails.helpers.bridge.getUploadStorageConfig
    const direct = sails.helpers.bridge.directUploadStorage
    let signed = 0
    sails.helpers.bridge.getUploadStorageConfig = {
      with: async () => ({ publicUrl: 'https://assets.example.test' })
    }
    sails.helpers.bridge.directUploadStorage = {
      with: async (args) => {
        if (args.operation === 'signPut') {
          signed++
          return {
            uploadUrl: 'https://upload.example.test/material',
            expiresInSeconds: 3600
          }
        }
        if (args.operation === 'head')
          return { size: 1024, type: 'application/pdf', etag: 'fixture' }
        throw new Error('Unexpected fixture storage operation')
      }
    }
    const actionPath =
      '/projects/upload-authority/environments/production/bridge/submission/actions/send-decision'
    const path = `${actionPath}/fields/material/upload`
    const inputs = {
      recordId: '1',
      values: {},
      fileName: 'slides.pdf',
      fileType: 'application/pdf',
      fileSize: 1024
    }
    try {
      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      expect(
        await request.as('genesisUser').post(`${path}/prepare`, inputs)
      ).toHaveStatus(403)
      expect(signed).toBe(0)
      const prepared = await browser.request.post(`${path}/prepare`, inputs)
      expect(prepared).toHaveStatus(200)
      const uploadIntent = prepared.data.uploadIntent
      const wrong = await browser.request.post(`${path}/complete`, {
        recordId: '2',
        uploadIntent
      })
      expect(wrong).toHaveStatus(400)
      const complete = await browser.request.post(`${path}/complete`, {
        recordId: '1',
        uploadIntent
      })
      expect(complete).toHaveStatus(200)
      const context = await browser.request.get(
        `${actionPath}/context?recordId=1`
      )
      const result = await browser.request.post(actionPath, {
        recordId: '1',
        conditionToken: context.data.conditionToken,
        values: {
          material: { url: complete.data.url, receipt: complete.data.receipt }
        }
      })
      expect(result).toHaveStatus(302)
      expect(state.calls.length).toBe(1)
      expect(state.calls[0].values.material).toBe(complete.data.url)
      state.denied = true
      const denied = await browser.request.post(`${path}/prepare`, inputs)
      expect(denied).toHaveStatus(400)
      expect(signed).toBe(1)
    } finally {
      sails.helpers.bridge.getUploadStorageConfig = storage
      sails.helpers.bridge.directUploadStorage = direct
      state.restore()
    }
  }
)
