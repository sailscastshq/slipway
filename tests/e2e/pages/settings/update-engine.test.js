const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

for (const surface of ['settings', 'modal']) {
  for (const stream of ['initial-failure', 'drop']) {
    test(
      `shared updater ${surface} reconciles ${stream} without mistaking the old server for rollback`,
      { browser: true, world: { name: 'configured-slipway' } },
      async ({ sails, world, login, page, expect }) => {
        const original = sails.helpers.system.checkForUpdates
        const info = {
          updateAvailable: true,
          currentVersion: '0.0.121',
          latestVersion: '0.0.122',
          releaseNotes: 'Shared updater engine'
        }
        sails.helpers.system.checkForUpdates = Object.assign(async () => info, {
          with: async () => info
        })
        try {
          await login.withPassword('genesisUser', page, {
            password: world.current.auth.genesisUserPassword
          })
          await page.raw.waitForURL('**/')
          await page.raw.addInitScript(() => {
            const Native = window.EventSource
            window.EventSource = class {
              constructor(url) {
                if (!String(url).includes('/system/stream-update'))
                  return new Native(url)
                window.__updateStream = this
              }
              close() {}
            }
            window.__operation = { phase: 'idle' }
            window.__postCount = 0
            window.__statusReads = 0
            const fetch = window.fetch.bind(window)
            window.fetch = async (url, options) => {
              if (String(url).startsWith('/api/v1/system/update-status')) {
                window.__statusReads++
                return new Response(JSON.stringify(window.__operation), {
                  status: 200
                })
              }
              if (String(url) === '/api/v1/system/apply-update') {
                window.__postCount++
                window.__operation = {
                  operationId: '859-fixture',
                  phase: 'validating',
                  targetVersion: '0.0.122',
                  detail: 'Checking new version',
                  canRetry: false,
                  updatedAt: Date.now()
                }
                return new Response(JSON.stringify(window.__operation), {
                  status: 202
                })
              }
              if (String(url) === '/health')
                return new Response(
                  JSON.stringify({ status: 'ok', version: '0.0.121' }),
                  { status: 200 }
                )
              return fetch(url, options)
            }
          })
          await page.goto('/settings/update')
          if (surface === 'modal') {
            await page.raw
              .locator('[data-test="desktop-user-menu-button"]')
              .click()
            await page.raw
              .locator('#desktop-user-menu')
              .getByText('Update available', { exact: true })
              .click()
          }
          await page.raw.clock.install()
          await page.raw
            .getByRole('button', { name: 'Update Now', exact: true })
            .last()
            .click()
          await page.raw.waitForFunction(() =>
            Boolean(window.__updateStream?.onerror)
          )
          if (stream === 'drop') {
            await page.raw.evaluate(() => window.__updateStream.onopen())
            await page.raw.evaluate(() =>
              window.__updateStream.onmessage({
                data: JSON.stringify(window.__operation)
              })
            )
          }
          await page.raw.evaluate(() => window.__updateStream.onerror({}))
          await page.raw.clock.runFor(10000)
          await expect(page.raw.getByText(/likely rolled back/)).toHaveCount(0)
          assert.ok(
            await page.raw.evaluate(() => window.__statusReads > 0),
            'progress must reconcile even if SSE never opens'
          )
          await page.raw.clock.runFor(70000)
          await expect(
            page.raw.getByText('Update failed', { exact: true })
          ).toHaveCount(0)
          expect(await page.raw.evaluate(() => window.__postCount)).toBe(1)
          const output = path.resolve('.tmp/screenshots/issue-859-updater')
          fs.mkdirSync(output, { recursive: true })
          await page.screenshot(
            path.join(output, `${surface}-${stream}-desktop.png`),
            { animations: 'disabled' }
          )
          await page.resize(390, 844)
          await page.screenshot(
            path.join(output, `${surface}-${stream}-mobile.png`),
            { animations: 'disabled' }
          )
          await page.raw.evaluate(() => {
            window.__operation = {
              ...window.__operation,
              phase: 'failed',
              detail: 'Preflight failed; current release is unchanged.',
              canRetry: true,
              updatedAt: Date.now()
            }
          })
          await page.raw.clock.runFor(5000)
          await expect(
            page.raw
              .getByText('Preflight failed; current release is unchanged.', {
                exact: true
              })
              .last()
          ).toBeVisible()
          expect(page).toHaveNoJavascriptErrors()
        } finally {
          sails.helpers.system.checkForUpdates = original
        }
      }
    )
  }
}
