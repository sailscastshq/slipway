const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

for (const browser of ['desktop', 'mobile']) {
  test(
    `Infrastructure prune review, progress, results and holds on ${browser}`,
    { browser, world: 'configured-slipway' },
    async ({ sails, world, page, login, expect }) => {
      const original = {
        update: sails.helpers.buildCacheRetention.getUpdateStatus,
        quest: sails.instanceQuest,
        inventory: sails.helpers.buildCacheRetention.getInventory,
        disk: sails.helpers.lookout.getDiskSpace,
        health: sails.helpers.lookout.getObservabilityHealth
      }
      sails.helpers.buildCacheRetention.getUpdateStatus = async () => ({
        phase: 'idle'
      })
      let run = null
      let calls = 0
      let activeCache = 0
      const setProgress = async (phase) => {
        await sails.helpers.setting.set(
          'buildCacheRetentionLastRun',
          JSON.stringify({
            requestId: run.id,
            phase,
            startedAt: Date.parse(run.startedAt),
            updatedAt: Date.now()
          })
        )
      }
      const disk = async () => ({
        usedPercent: run?.state === 'completed' ? 53 : 61,
        used: run?.state === 'completed' ? '159 GB' : '175 GB',
        total: '300 GB',
        available: run?.state === 'completed' ? '129 GB' : '113 GB',
        totalBytes: 300 * 1024 ** 3,
        availableBytes: (run?.state === 'completed' ? 129 : 113) * 1024 ** 3,
        mount: '/'
      })
      const health = async () => ({
        collector: {
          status: 'healthy',
          lastSuccessAt: Date.now(),
          rowCount: 12400
        },
        retention: {
          status: 'healthy',
          lastSuccessAt: Date.now() - 60000,
          rowCount: 895700
        }
      })
      disk.with = disk
      health.with = health
      sails.helpers.lookout.getDiskSpace = disk
      sails.helpers.lookout.getObservabilityHealth = health
      sails.helpers.buildCacheRetention.getInventory = async () => ({
        entries: 120,
        active: activeCache,
        size: '42.8GB',
        reclaimable: '23.6GB (55%)'
      })
      sails.instanceQuest = {
        snapshot: async () => ({
          available: true,
          jobs: [
            {
              name: 'retain-build-cache',
              manualAllowed: !run || run.state === 'completed'
            }
          ],
          runs: run ? [run] : []
        }),
        trigger: async (name, id, inputs) => {
          calls++
          expect(name).toBe('retain-build-cache')
          expect(inputs).toEqual({})
          run = {
            id,
            name,
            state: 'running',
            startedAt: new Date().toISOString(),
            updatedAt: Date.now()
          }
          await setProgress('checking')
          return { run, duplicate: false }
        }
      }
      try {
        await login.withPassword('genesisUser', page, {
          password: world.current.auth.genesisUserPassword
        })
        await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
        await page.raw.setViewportSize({
          width: browser === 'mobile' ? 390 : 1440,
          height: browser === 'mobile' ? 844 : 1000
        })
        await page.goto('/lookout')
        const output = path.resolve('.tmp/screenshots/issue-881')
        const capture = async (file) => {
          await page.raw.evaluate(async () => {
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
            await Promise.all(
              document
                .getAnimations()
                .filter((a) => a.effect?.getTiming().iterations !== Infinity)
                .map((a) => a.finished.catch(() => {}))
            )
          })
          await page.screenshot(file)
        }
        fs.mkdirSync(output, { recursive: true })
        const prune = page.raw.getByRole('button', {
          name: 'Prune',
          exact: true
        })
        await expect(prune).toBeVisible()
        for (const colorScheme of ['light', 'dark']) {
          await page.raw.emulateMedia({ colorScheme })
          await capture(
            path.join(output, `${browser}-${colorScheme}-host-disk.png`)
          )
          await prune.click()
          const dialog = page.raw.getByRole('dialog')
          await expect(
            dialog.getByText('23.6GB (55%)', { exact: true })
          ).toBeVisible()
          await expect(
            dialog.getByRole('button', { name: 'Prune cache', exact: true })
          ).toBeEnabled()
          await expect(
            dialog.getByText('20.0 GiB', { exact: true })
          ).toBeVisible()
          await capture(
            path.join(output, `${browser}-${colorScheme}-review.png`)
          )
          await dialog
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
          expect(calls).toBe(0)
          await expect(prune).toBeFocused()
        }
        await prune.click()
        const dialog = page.raw.getByRole('dialog')
        await dialog
          .getByRole('button', { name: 'Prune cache', exact: true })
          .click()
        await expect(
          page.raw.getByRole('button', { name: 'View progress' })
        ).toBeVisible()
        expect(calls).toBe(1)
        const toast = page.raw.locator('[data-test="host-cleanup-toast"]')
        await expect(
          toast.getByText('Checking disk cleanup', { exact: true })
        ).toBeVisible()
        await setProgress('pruning')
        await expect(
          toast.getByText('Pruning unused build cache', { exact: true })
        ).toBeVisible()
        await page.raw.emulateMedia({ colorScheme: 'light' })
        await capture(path.join(output, `${browser}-light-running-toast.png`))
        await page.raw.emulateMedia({ colorScheme: 'dark' })
        await capture(path.join(output, `${browser}-dark-running-toast.png`))
        if (browser === 'desktop') {
          await page.raw
            .getByRole('link', { name: 'Projects', exact: true })
            .first()
            .click()
          await page.raw.waitForURL((url) => url.pathname === '/')
          await expect(
            toast.getByText('Pruning unused build cache', { exact: true })
          ).toBeVisible()
          await page.raw
            .getByRole('link', { name: 'Lookout', exact: true })
            .first()
            .click()
          await expect(
            page.raw.getByRole('button', { name: 'View progress' })
          ).toBeVisible()
        }
        await toast
          .getByRole('button', { name: 'Dismiss disk cleanup status' })
          .click()
        await page.raw.waitForResponse((response) =>
          response.url().includes('/api/v1/bosun/quest/runs/')
        )
        await expect(toast).toHaveCount(0)
        await page.raw.reload()
        await expect(
          toast.getByText('Pruning unused build cache', { exact: true })
        ).toBeVisible()
        expect(calls).toBe(1)
        await setProgress('refreshing')
        await expect(
          toast.getByText('Refreshing disk measurements', { exact: true })
        ).toBeVisible()
        await page.raw.getByRole('button', { name: 'View progress' }).click()
        await expect(
          dialog.getByRole('button', { name: 'Prune cache', exact: true })
        ).toBeDisabled()
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        expect(calls).toBe(1)
        run.state = 'completed'
        run.finishedAt = new Date().toISOString()
        run.result = JSON.stringify({
          status: 'available',
          value: {
            status: 'complete',
            filesystemAvailableDeltaBytes: 16 * 1024 ** 3,
            dockerReportedReclaimed: '18.2GB',
            holds: []
          }
        })
        await expect(
          page.raw
            .locator('[data-test=host-disk-prune]')
            .getByRole('status')
            .filter({ hasText: 'Cleanup complete' })
        ).toBeVisible()
        await expect(
          page.raw.getByText('129 GB', { exact: true })
        ).toBeVisible()
        await capture(path.join(output, `${browser}-dark-complete.png`))
        await expect(
          toast.getByText('Build cache cleanup complete', { exact: true })
        ).toBeVisible()
        await capture(path.join(output, `${browser}-dark-complete-toast.png`))
        await page.raw.reload()
        await expect(
          page.raw
            .locator('[data-test=host-disk-prune]')
            .getByRole('status')
            .filter({ hasText: 'Cleanup complete' })
        ).toBeVisible()
        expect(calls).toBe(1)
        await prune.click()
        await expect(
          dialog.getByText('Docker reported 18.2GB reclaimed.')
        ).toBeVisible()
        await capture(path.join(output, `${browser}-dark-result.png`))
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        activeCache = 1
        await prune.click()
        await expect(
          dialog.getByText('A Docker build is using cache.')
        ).toBeVisible()
        await expect(
          dialog.getByRole('button', { name: 'Prune cache', exact: true })
        ).toBeDisabled()
        expect(calls).toBe(1)
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        activeCache = 0
        await prune.click()
        await dialog
          .getByRole('button', { name: 'Prune cache', exact: true })
          .click()
        await expect(
          toast.getByText('Checking disk cleanup', { exact: true })
        ).toBeVisible()
        expect(calls).toBe(2)
        run.state = 'failed'
        run.error =
          'Cache cleanup completion is unconfirmed. Inspect Docker before retrying or resuming deployments; the maintenance hold stays in place.'
        await setProgress('unconfirmed')
        await expect(
          toast.getByText('Cleanup outcome unconfirmed', { exact: true })
        ).toBeVisible()
        await capture(path.join(output, `${browser}-dark-failure-toast.png`))
        await toast.getByRole('link', { name: 'View details' }).click()
        await expect(page.raw.getByRole('dialog')).toBeVisible()
        await expect(
          page.raw.getByRole('dialog').getByText(run.error, { exact: true })
        ).toBeVisible()
        expect(calls).toBe(2)
        await page.raw
          .getByRole('dialog')
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        await sails.models.user
          .updateOne({ id: world.current.users.genesisUser.id })
          .set({ isGenesisUser: false })
        await page.raw.reload()
        await expect(
          page.raw.locator('[data-test="host-disk-prune"]')
        ).toHaveCount(0)
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true)
        expect(page).toHaveNoJavascriptErrors()
      } finally {
        sails.helpers.buildCacheRetention.getUpdateStatus = original.update
        sails.instanceQuest = original.quest
        sails.helpers.buildCacheRetention.getInventory = original.inventory
        sails.helpers.lookout.getDiskSpace = original.disk
        sails.helpers.lookout.getObservabilityHealth = original.health
      }
    }
  )
}
