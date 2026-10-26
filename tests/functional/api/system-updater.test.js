const { test } = require('sounding')
const assert = require('node:assert/strict')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')
test(
  'updater admission and durable status keep instance-admin and CSRF protection',
  {
    transport: 'http',
    world: { name: 'configured-slipway' }
  },
  async ({ sails, world, request, expect }) => {
    const oldApply = sails.helpers.system.applyUpdate,
      oldStatus = sails.helpers.system.getUpdateStatus
    let admissions = 0
    const operation = {
      operationId: '859-api-proof',
      phase: 'validating',
      targetVersion: '0.0.122',
      canRetry: false
    }
    sails.helpers.system.applyUpdate = async () => {
      admissions++
      return operation
    }
    sails.helpers.system.getUpdateStatus = async () => operation
    try {
      const anonymous = await request.get('/api/v1/system/update-status')
      expect(anonymous).toHaveStatus(401)
      const member = await sails.models.user
        .create({
          fullName: 'Updater member',
          email: 'updater-member@example.test',
          isGenesisUser: false
        })
        .fetch()
      const memberCookie = await createSessionCookie(sails, {
        userId: member.id
      })
      expect(
        await request
          .withHeaders({ cookie: memberCookie })
          .get('/api/v1/system/update-status')
      ).toHaveStatus(403)
      const cookie = await createSessionCookie(sails, {
        userId: world.current.users.genesisUser.id
      })
      const authed = request.withHeaders({ cookie })
      const noCsrf = await authed.post('/api/v1/system/apply-update', {})
      expect(noCsrf).toHaveStatus(403)
      assert.equal(admissions, 0)
      const browser = await withCsrfFromPage(authed, '/')
      const started = await browser.request.post(
        '/api/v1/system/apply-update',
        {}
      )
      expect(started).toHaveStatus(202)
      assert.equal(started.data.operationId, operation.operationId)
      const status = await browser.request.get('/api/v1/system/update-status')
      expect(status).toHaveStatus(200)
      assert.equal(status.data.phase, 'validating')
      sails.helpers.system.getUpdateStatus = async () => {
        throw Error('fixture unavailable')
      }
      expect(
        await browser.request.get('/api/v1/system/update-status')
      ).toHaveStatus(503)
    } finally {
      sails.helpers.system.applyUpdate = oldApply
      sails.helpers.system.getUpdateStatus = oldStatus
    }
  }
)
