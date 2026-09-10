const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Bridge navigates and submits canonical aliases while preserving model and action identities',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'url-slugs' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const original = { ...sails.helpers.bridge }
    let record = { id: 42, title: 'SailsConf 2026' }
    let executions = 0
    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: {
        conferenceevent: {
          identity: 'conferenceevent',
          primaryKey: 'id',
          attributes: {
            id: { type: 'number', autoIncrement: true },
            title: { type: 'string' }
          }
        }
      },
      config: {
        resources: {
          conferenceevent: {
            slug: 'event',
            label: 'Events',
            singularLabel: 'Event',
            title: 'title',
            authorization: 'bridge.authorize',
            actions: {
              requestChanges: {
                scope: 'record',
                helper: 'bridge.requestChanges',
                label: 'Request changes',
                confirm: 'Request changes to this event?',
                success: 'Changes requested.'
              }
            }
          }
        }
      }
    })
    await sails.models.app
      .updateOne({ id: world.current.apps.web.id })
      .set({ status: 'running', containerName: 'url-slugs' })
    sails.helpers.bridge.introspectModels = async () => ({
      ...contract,
      models: contract.resources
    })
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (_container, code) => {
      let output = {}
      if (code.includes('const decisions = Object.create(null);')) {
        const requests = JSON.parse(code.match(/const requests = (.*);/)[1])
        for (const r of requests) {
          expect(r.action.includes('-')).toBe(false)
          output[r.key] ||= {}
          output[r.key][r.action] = true
        }
      }
      if (code.includes('const counts = {};')) output = { conferenceevent: 1 }
      if (code.includes('const records = await'))
        output = { records: [record], total: 1 }
      if (code.includes('const fieldErrors = {};')) output = { fieldErrors: {} }
      if (code.includes('const record = await model.findOne(criteria)'))
        output = { record }
      if (code.includes('await model.updateOne(criteria).set(values);')) {
        expect(code).toContain('conferenceevent')
        record = {
          ...record,
          ...JSON.parse(code.match(/const values = (.*);/)[1])
        }
        output = { record }
      }
      if (code.includes('const helperIdentity =')) {
        const helper = async (inputs) => {
          expect(inputs.resource.identity).toBe('conferenceevent')
          expect(inputs.recordId).toBe(42)
          executions++
          return {}
        }
        helper.with = helper
        output = await new Function(
          'sails',
          `return (async () => {${code}})();`
        )({ helpers: { bridge: { requestChanges: helper } } })
      }
      return {
        success: true,
        output: JSON.stringify(output),
        error: null,
        exitCode: 0
      }
    }
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      const base = '/projects/url-slugs/environments/production/bridge'
      await page.goto(`${base}/conferenceevent/42/edit`)
      await page.raw
        .locator('#bridge-conferenceevent-title')
        .fill('SailsConf 2026 proposals')
      await page.raw
        .getByRole('button', { name: 'Save changes', exact: true })
        .click()
      await page.raw.waitForURL((url) => url.pathname === `${base}/event/42`)
      await expect(
        page.raw.getByText('SailsConf 2026 proposals', { exact: true }).first()
      ).toBeVisible()
      const out = path.resolve('output/issue-573')
      fs.mkdirSync(out, { recursive: true })
      for (const width of [1280, 390]) {
        await page.raw.setViewportSize({ width, height: 900 })
        await page.screenshot(path.join(out, `bridge-event-${width}.png`), {
          animations: 'disabled'
        })
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true)
      }
      await page.raw.setViewportSize({ width: 1280, height: 900 })
      await page.raw
        .getByRole('button', {
          name: 'Actions for SailsConf 2026 proposals',
          exact: true
        })
        .click()
      await page.raw
        .getByRole('menuitem', { name: 'Request changes', exact: true })
        .click()
      await expect(
        page.raw.locator('[data-test="bridge-action-dialog-requestChanges"]')
      ).toBeVisible()
      await page.screenshot(path.join(out, 'bridge-request-changes.png'), {
        animations: 'disabled'
      })
      const posted = page.raw.waitForRequest(
        (req) =>
          req.method() === 'POST' &&
          req.url().endsWith('/event/actions/request-changes')
      )
      await page.raw
        .getByRole('button', { name: 'Request changes', exact: true })
        .click()
      await posted
      await expect(
        page.raw.getByText('Changes requested.', { exact: true }).first()
      ).toBeVisible()
      expect(executions).toBe(1)
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      Object.assign(sails.helpers.bridge, original)
    }
  }
)
