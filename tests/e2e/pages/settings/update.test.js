const { test } = require('sounding')
const { expect } = require('@playwright/test')

for (const outcome of ['updated', 'old-version', 'missing-version']) {
  test(
    `update page follows verified engine outcome after a stream drop: ${outcome}`,
    { browser: true, world: { name: 'configured-slipway' } },
    async ({ sails, world, login, page }) => {
      const original = sails.helpers.system.checkForUpdates
      sails.helpers.system.checkForUpdates = async () => ({
        updateAvailable: true,
        currentVersion: '0.0.89',
        latestVersion: '0.0.90',
        releaseNotes: 'Database recovery safeguards'
      })
      sails.helpers.system.checkForUpdates.with =
        sails.helpers.system.checkForUpdates
      try {
        await login.withPassword('genesisUser', page, {
          password: world.current.auth.genesisUserPassword
        })
        await page.raw.waitForURL('**/')
        await page.raw.addInitScript((outcome) => {
          const NativeEventSource = window.EventSource
          window.EventSource = class {
            constructor(url) {
              if (!String(url).includes('/api/v1/system/stream-update'))
                return new NativeEventSource(url)
              window.__updateStream = this
            }
            close() {}
          }
          const nativeFetch = window.fetch.bind(window)
          window.fetch = async (url, options) => {
            if (String(url) === '/api/v1/system/apply-update')
              return new Response(
                JSON.stringify({
                  phase: 'starting',
                  operationId: 'verified-fixture',
                  targetVersion: '0.0.90'
                }),
                { status: 202 }
              )
            if (String(url) === '/api/v1/system/update-status') {
              const elapsed = window.__updateStarted
                ? Date.now() - window.__updateStarted
                : -1
              const phase =
                elapsed < 0
                  ? 'idle'
                  : elapsed >= 80000 && outcome === 'updated'
                  ? 'success'
                  : elapsed >= 360000
                  ? 'rolled-back'
                  : 'waiting'
              return new Response(
                JSON.stringify({
                  phase,
                  operationId: elapsed < 0 ? undefined : 'verified-fixture',
                  targetVersion: '0.0.90',
                  canRetry: phase === 'rolled-back',
                  detail:
                    phase === 'rolled-back'
                      ? 'The engine verified the previous container is restored and healthy.'
                      : ''
                }),
                { status: 200 }
              )
            }
            return nativeFetch(url, options)
          }
        }, outcome)
        await page.goto('/settings/update')
        await page.raw.clock.install()
        await page.raw.getByRole('button', { name: 'Update Now' }).click()
        await page.raw.waitForFunction(() =>
          Boolean(window.__updateStream?.onopen)
        )
        await page.raw.evaluate(() => window.__updateStream.onopen())
        await page.raw.evaluate(() => {
          window.__updateStarted = Date.now()
          window.__updateStream.onmessage({
            data: JSON.stringify({ phase: 'swapping' })
          })
        })
        await page.raw.evaluate(() => window.__updateStream.onerror({}))
        await page.raw.clock.runFor(70000)
        await expect(
          page.raw.getByText('Waiting for normal startup…', {
            exact: true
          })
        ).toBeVisible()
        await expect(
          page.raw.getByText('Update failed', { exact: true })
        ).toHaveCount(0)
        await page.raw.clock.runFor(10000)
        if (outcome !== 'updated') {
          await expect(
            page.raw.getByText('Update failed', { exact: true })
          ).toHaveCount(0)
          await page.raw.clock.runFor(280000)
          await expect(
            page.raw.getByText('Update failed', { exact: true })
          ).toBeVisible()
          await expect(
            page.raw.getByText('Update complete! Reloading...', { exact: true })
          ).toHaveCount(0)
          return
        }
        await expect(
          page.raw.getByText('Update complete! Reloading...', { exact: true })
        ).toBeVisible()
      } finally {
        sails.helpers.system.checkForUpdates = original
      }
    }
  )
}
