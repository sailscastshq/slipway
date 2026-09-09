const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { withCsrfFromPage } = require('../../../support/csrf-request')
test(
  'Bridge support requires owner reauthentication, scopes grants, supports revocation, and uses a two-action Klean dialog',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'support-admin' } }
    }
  },
  async ({ sails, world, request, login, page, expect }) => {
    const app = world.current.apps.web
    await sails.models.app.updateOne({ id: app.id }).set({
      bridgeEnabled: true,
      bridgeSecret: 'slb_support_admin_test',
      status: 'running',
      containerName: 'support-admin-fixture'
    })
    const originals = {
      descriptor: sails.helpers.bridge.supportDescriptor,
      resource: sails.helpers.bridge.loadResource,
      execute: sails.helpers.bridge.executeInContainer,
      url: sails.helpers.bridge.getAppUrl
    }
    const resource = {
      identity: 'creator',
      primaryKey: 'id',
      title: 'fullName',
      label: 'Creators',
      singularLabel: 'Creator',
      show: ['id', 'fullName'],
      attributes: {
        id: { type: 'string', label: 'ID' },
        fullName: { type: 'string', label: 'Name' }
      },
      actions: { update: false, delete: false },
      relationships: {}
    }
    sails.helpers.bridge.supportDescriptor = {
      with: async () => ({ enabled: true, model: 'creator' })
    }
    sails.helpers.bridge.loadResource = {
      with: async () => ({ resource, recordId: 'customer', contract: {} })
    }
    sails.helpers.bridge.executeInContainer = async () => ({
      success: true,
      output: JSON.stringify({
        record: { id: 'customer', fullName: 'Ada Customer' }
      })
    })
    sails.helpers.bridge.getAppUrl = {
      with: async () => 'https://creator.example.test'
    }
    const base = `/projects/support-admin/environments/production/apps/${app.slug}/bridge/creator/customer`
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.goto(base)
      await page.raw
        .locator('[data-test="bridge-record-action-menu-trigger"]')
        .click()
      await page.raw
        .getByRole('menuitem', { name: 'View as this user', exact: true })
        .click()
      const dialog = page.raw.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog
        .getByLabel('Reason', { exact: true })
        .fill('Investigating missing invoice access')
      const output = path.resolve('output/issue-500')
      await fs.mkdir(output, { recursive: true })
      for (const [width, colorScheme] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await page.raw.emulateMedia({ colorScheme })
        await expect(dialog.getByRole('button')).toHaveCount(2)
        assert.equal(
          await dialog
            .getByLabel('Reason', { exact: true })
            .evaluate((el) => getComputedStyle(el).borderBottomStyle),
          'dashed'
        )
        assert.equal(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
          true
        )
        await page.screenshot(
          path.join(output, `support-dialog-${width}.png`),
          { animations: 'disabled' }
        )
      }
      const api = (await withCsrfFromPage(request, '/', 'genesisUser')).request
      const attempt = (password, url = base + '/support') =>
        api.post(url, {
          reason: 'Investigating missing invoice access',
          password
        })
      assert.equal((await attempt('incorrect')).status, 400)
      assert.equal(
        (
          await attempt(
            world.current.auth.genesisUserPassword,
            base.replace('/creator/', '/other/') + '/support'
          )
        ).status,
        400
      )
      const result = await attempt(world.current.auth.genesisUserPassword)
      assert.equal(result.status, 200, JSON.stringify(result.data))
      const token = new URL(result.data.url).hash.slice(1)
      const grant = await sails.models.bridgesupportgrant.findOne({
        id: result.data.grantId
      })
      assert.notEqual(grant.tokenHash, token)
      assert.equal(grant.scope.subject, 'customer')
      const host = request.withHeaders({
        authorization: 'Bearer slb_support_admin_test'
      })
      const exchange = {
        appId: String(app.id),
        action: 'exchange',
        code: token,
        nonce: 'a'.repeat(64)
      }
      assert.equal(
        (await host.post('/api/v1/bridge/support', exchange)).status,
        200
      )
      assert.equal(
        (await host.post('/api/v1/bridge/support', exchange)).status,
        403
      )
      assert.equal(
        (await api.post(`/api/v1/bridge/support/${grant.id}/revoke`, {}))
          .status,
        200
      )
      assert.equal(
        (await sails.models.bridgesupportgrant.findOne({ id: grant.id }))
          .status,
        'revoked'
      )
      const auditEvent = {
        appId: String(app.id),
        action: 'event',
        grantId: String(grant.id),
        event: 'stopped',
        eventId: 'b'.repeat(32),
        occurredAt: Date.now()
      }
      assert.equal(
        (await host.post('/api/v1/bridge/support', auditEvent)).status,
        200
      )
      assert.equal(
        (await host.post('/api/v1/bridge/support', auditEvent)).status,
        200
      )
      assert.equal(
        await sails.models.bridgesupportevent.count({
          eventId: auditEvent.eventId
        }),
        1
      )
      assert.equal(
        (
          await host.post('/api/v1/bridge/support', {
            ...auditEvent,
            eventId: 'c'.repeat(32),
            occurredAt: Date.now() + 60000
          })
        ).status,
        403
      )
      const events = await sails.models.auditlog.find({
        resourceId: String(app.id)
      })
      assert.ok(!JSON.stringify(events).includes(token))
      const owner = await world
        .create('user')
        .with({ email: 'support-owner@example.test' })
      await sails.models.team
        .updateOne({ id: world.current.teams.genesisTeam.id })
        .set({ owner: owner.id })
      await sails.models.teammembership
        .updateOne({
          user: world.current.users.genesisUser.id,
          team: world.current.teams.genesisTeam.id
        })
        .set({ role: 'member' })
      assert.equal(
        (await attempt(world.current.auth.genesisUserPassword)).status,
        403
      )
    } finally {
      sails.helpers.bridge.supportDescriptor = originals.descriptor
      sails.helpers.bridge.loadResource = originals.resource
      sails.helpers.bridge.executeInContainer = originals.execute
      sails.helpers.bridge.getAppUrl = originals.url
    }
  }
)
