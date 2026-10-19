const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('sounding')

test(
  'Bosun Quest renders safe fixture jobs, requires review and displays live output on desktop and phone',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, page, login, world, expect }) => {
    const previous = sails.instanceQuest
    const now = new Date().toISOString()
    const jobs = [
      {
        name: 'retain-deployment-images',
        friendlyName: 'Clean up deployment images',
        description:
          'Remove eligible old app deployment images while preserving running work and recovery references.',
        schedule: { interval: '24 hours', timezone: 'UTC' },
        scheduled: true,
        nextRunAt: '2026-10-22T03:30:00Z',
        runningCount: 0,
        manualAllowed: true,
        cleanupEnabled: true
      },
      {
        name: 'run-scheduled-backups',
        friendlyName: 'Run scheduled backups',
        description: 'Process due backup schedules.',
        schedule: { interval: '1 minute', timezone: 'UTC' },
        scheduled: true,
        nextRunAt: '2026-10-22T03:01:00Z',
        runningCount: 1,
        manualAllowed: false
      },
      {
        name: 'maintain-observability',
        friendlyName: 'Maintain observability',
        description: 'Prune retained telemetry and check host disk health.',
        schedule: { interval: '5 minutes', timezone: 'UTC' },
        scheduled: true,
        nextRunAt: '2026-10-22T03:05:00Z',
        runningCount: 0,
        manualAllowed: true
      },
      {
        name: 'retain-build-cache',
        friendlyName: 'Clean up old build cache',
        description: 'Remove only unused old build cache.',
        schedule: { cron: '17 * * * *', timezone: 'UTC' },
        scheduled: true,
        nextRunAt: '2026-10-22T03:17:00Z',
        runningCount: 0,
        manualAllowed: true,
        cleanupEnabled: true
      }
    ]
    const runs = [
      {
        id: randomUUID(),
        name: 'run-scheduled-backups',
        trigger: 'scheduled',
        state: 'running',
        startedAt: now,
        logs: {
          stdout:
            'Safe fixture: checking due schedules\nSafe fixture: processing backup 2 of 3',
          stderr: ''
        }
      },
      {
        id: randomUUID(),
        name: 'retain-deployment-images',
        trigger: 'scheduled',
        state: 'completed',
        startedAt: now,
        finishedAt: now,
        logs: {
          stdout: 'Safe fixture: dry-run complete. 2 candidates, 0 removed.',
          stderr: ''
        },
        result: JSON.stringify({
          status: 'available',
          value: { mode: 'dry-run', candidates: 2, removed: [], protected: 12 }
        })
      }
    ]
    runs.push({
      id: randomUUID(),
      name: 'run-scheduled-backups',
      trigger: 'manual',
      state: 'failed',
      startedAt: now,
      finishedAt: now,
      error: 'Safe fixture: backup destination unavailable',
      logs: {
        stdout: '',
        stderr: 'Safe fixture: retry after checking destination',
        truncated: true
      },
      result: '{invalid retained result'
    })
    let starts = 0
    const requests = []
    sails.instanceQuest = {
      snapshot: async () => ({ available: true, jobs, runs, liveLogs: true }),
      trigger: async (name, requestId, jobInputs) => {
        requests.push(jobInputs)
        starts++
        const run = {
          id: requestId,
          name,
          trigger: 'manual',
          state: 'completed',
          startedAt: now,
          logs: {
            stdout: jobInputs.preview
              ? 'Safe fixture: preview only. No Docker commands executed.'
              : 'Safe fixture: cleanup complete; removed 2, skipped 1, errors 0, deferred 1.',
            stderr: ''
          },
          result: JSON.stringify({
            status: 'available',
            value: {
              mode: jobInputs.preview ? 'dry-run' : 'remove',
              removed: jobInputs.preview ? 0 : 2,
              skipped: 1,
              errors: 0,
              deferred: 1
            }
          })
        }
        runs.unshift(run)
        return { run, duplicate: false }
      }
    }
    try {
      await page.raw.route('**/api/v1/system/check-update', (route) =>
        route.fulfill({ json: { updateAvailable: false } })
      )
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      await page.goto('/bosun?tab=quest')
      const panel = page.raw.locator('[data-test="instance-quest"]')
      const output = path.resolve('output/bosun-quest')
      fs.mkdirSync(output, { recursive: true })
      await expect(
        panel.getByRole('heading', {
          name: 'Clean up deployment images',
          exact: true
        })
      ).toBeVisible()
      await expect(panel.getByRole('button', { name: /preview/i })).toHaveCount(
        0
      )
      await expect(
        panel.getByRole('button', { name: /^Actions for / })
      ).toHaveCount(jobs.length)
      expect(starts).toBe(0)
      const cleanupActions = panel.getByRole('button', {
        name: 'Actions for Clean up deployment images',
        exact: true
      })
      const backupActions = panel.getByRole('button', {
        name: 'Actions for Run scheduled backups',
        exact: true
      })
      const cleanupMenu = page.raw.getByRole('menu', {
        name: 'Actions for Clean up deployment images',
        exact: true
      })
      const backupMenu = page.raw.getByRole('menu', {
        name: 'Actions for Run scheduled backups',
        exact: true
      })
      await backupActions.click()
      await expect(
        backupMenu.getByRole('menuitem', { name: 'Run now', exact: true })
      ).toBeDisabled()
      await page.raw.keyboard.press('Escape')
      await expect(backupActions).toBeFocused()
      await panel
        .getByRole('button', {
          name: 'Runs for Run scheduled backups',
          exact: true
        })
        .click()
      const backupRuns = panel.getByRole('region', {
        name: 'Runs for Run scheduled backups',
        exact: true
      })
      await expect(backupRuns.getByLabel('Instance run detail')).toHaveCount(0)
      await backupRuns.getByRole('button', { name: /^scheduled run/ }).click()
      await expect(backupRuns.getByLabel('Instance run detail')).toContainText(
        'Safe fixture: processing backup 2 of 3'
      )
      runs[0].logs.stdout += '\nSafe fixture: live output refreshed'
      await expect(backupRuns.getByLabel('Instance run detail')).toContainText(
        'Safe fixture: live output refreshed'
      )
      const failedRun = backupRuns.getByRole('button', { name: /^manual run/ })
      await failedRun.click()
      const failureDetail = backupRuns
        .locator(`[data-run="${runs[2].id}"]`)
        .getByLabel('Instance run detail')
      await expect(failureDetail).toContainText(
        'Safe fixture: backup destination unavailable'
      )
      await expect(failureDetail).toContainText(
        'Safe fixture: retry after checking destination'
      )
      await expect(failureDetail).toContainText(
        'Showing the retained output tail'
      )
      await expect(failureDetail).toContainText(
        'The return value exceeded the capture limit'
      )
      await expect(backupRuns.getByLabel('Instance run detail')).toHaveCount(2)
      await failedRun.click()
      const cleanupJob = panel.getByRole('button', {
        name: 'Runs for Clean up deployment images',
        exact: true
      })
      await cleanupJob.click()
      const cleanupRuns = panel.getByRole('region', {
        name: 'Runs for Clean up deployment images',
        exact: true
      })
      await cleanupRuns.getByRole('button', { name: /^scheduled run/ }).click()
      await expect(cleanupRuns.getByLabel('Instance run detail')).toContainText(
        '2 candidates, 0 removed'
      )
      await expect(backupRuns.getByLabel('Instance run detail')).toBeVisible()
      await cleanupJob.click()
      await expect(cleanupRuns).toHaveCount(0)
      await expect(backupRuns.getByLabel('Instance run detail')).toBeVisible()
      await cleanupJob.click()
      await expect(cleanupRuns.getByLabel('Instance run detail')).toContainText(
        '2 candidates, 0 removed'
      )
      await cleanupRuns.getByRole('button', { name: /^scheduled run/ }).click()
      await expect(cleanupRuns.getByLabel('Instance run detail')).toHaveCount(0)
      const emptyJob = panel.getByRole('button', {
        name: 'Runs for Maintain observability',
        exact: true
      })
      await emptyJob.focus()
      await page.raw.keyboard.press('Enter')
      await expect(
        panel.getByRole('region', { name: 'Runs for Maintain observability' })
      ).toContainText('No runs recorded yet')
      await emptyJob.click()
      for (const width of [1440, 390]) {
        for (const theme of ['light', 'dark']) {
          await page.raw.setViewportSize({ width, height: 1100 })
          await page.raw.emulateMedia({ colorScheme: theme })
          await panel
            .getByRole('heading', { name: 'Instance jobs', exact: true })
            .scrollIntoViewIfNeeded()
          await emptyJob.blur()
          await page.raw.screenshot({
            path: path.join(output, `inline-runs-${width}-${theme}.png`),
            animations: 'disabled'
          })
          expect(
            await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)
          ).toBe(true)
        }
      }
      for (const [width, theme] of [
        [1440, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 1100 })
        await page.raw.emulateMedia({ colorScheme: theme })
        await cleanupActions.scrollIntoViewIfNeeded()
        await cleanupActions.click()
        await expect(
          cleanupMenu.getByRole('menuitem', { name: 'Run now', exact: true })
        ).toBeEnabled()
        await expect(cleanupMenu.getByRole('menuitem')).toHaveCount(1)
        await expect(cleanupMenu).toBeVisible()
        await page.raw.waitForFunction(() => {
          const menu = document
            .getElementById('instance-job-actions-retain-deployment-images')
            ?.getBoundingClientRect()
          const trigger = document
            .querySelector(
              '[popovertarget="instance-job-actions-retain-deployment-images"]'
            )
            ?.getBoundingClientRect()
          return Boolean(
            menu &&
              trigger &&
              menu.y >= trigger.bottom &&
              Math.abs(menu.right - trigger.right) < 3
          )
        })
        await page.raw.screenshot({
          path: path.join(output, `instance-jobs-menu-${width}-${theme}.png`),
          animations: 'disabled'
        })
        expect(
          await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true)
        await page.raw.keyboard.press('Escape')
        await expect(cleanupActions).toBeFocused()
      }
      await cleanupActions.focus()
      await page.raw.keyboard.press('Enter')
      await expect(
        cleanupMenu.getByRole('menuitem', { name: 'Run now', exact: true })
      ).toBeFocused()
      await page.raw.keyboard.press('Enter')
      const review = panel.locator('[data-test="confirm-modal"]')
      await expect(review).toBeVisible()
      await expect(review).toContainText(
        'Remove eligible old deployment images now'
      )
      expect(starts).toBe(0)
      await review
        .getByRole('button', { name: 'Clean up', exact: true })
        .click()
      await expect(review).not.toBeVisible()
      await expect(
        cleanupRuns.getByLabel('Instance run detail').last()
      ).toContainText(
        'Safe fixture: cleanup complete; removed 2, skipped 1, errors 0, deferred 1.'
      )
      expect(starts).toBe(1)
      expect(requests[0]).toEqual({})
      await cleanupRuns
        .getByLabel('Instance run detail')
        .last()
        .scrollIntoViewIfNeeded()
      await cleanupRuns
        .getByLabel('Instance run detail')
        .last()
        .screenshot({
          path: path.join(output, 'instance-cleanup-menu-mobile-dark.png'),
          animations: 'disabled'
        })
      jobs[0].cleanupEnabled = false
      await cleanupActions.click()
      await expect(
        cleanupMenu.getByRole('menuitem', { name: 'Run now', exact: true })
      ).toBeDisabled()
      await page.raw.keyboard.press('Escape')
      const cacheActions = panel.getByRole('button', {
        name: 'Actions for Clean up old build cache',
        exact: true
      })
      const cacheMenu = page.raw.getByRole('menu', {
        name: 'Actions for Clean up old build cache',
        exact: true
      })
      await cacheActions.click()
      await cacheMenu.getByRole('menuitem', { name: 'Run now' }).click()
      await expect(review).toContainText('Clean up old build cache?')
      await expect(review).toContainText('Remove only unused old build cache')
      await review.screenshot({
        path: path.join(output, 'instance-cache-review-mobile-dark.png'),
        animations: 'disabled'
      })
      await review.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(starts).toBe(1)
      jobs[3].cleanupEnabled = false
      await cacheActions.click()
      await expect(
        cacheMenu.getByRole('menuitem', { name: 'Run now', exact: true })
      ).toBeDisabled()
      await page.raw.keyboard.press('Escape')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.instanceQuest = previous
    }
  }
)
