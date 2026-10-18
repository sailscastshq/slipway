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
        friendlyName: 'Retain deployment images',
        description:
          'Preview old deployment images while preserving running work and recovery references.',
        schedule: { interval: '24 hours', timezone: 'UTC' },
        scheduled: true,
        nextRunAt: '2026-10-22T03:30:00Z',
        runningCount: 0,
        manualAllowed: true
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
    let starts = 0
    sails.instanceQuest = {
      snapshot: async () => ({ available: true, jobs, runs, liveLogs: true }),
      trigger: async (name, requestId) => {
        starts++
        const run = {
          id: requestId,
          name,
          trigger: 'manual',
          state: 'completed',
          startedAt: now,
          logs: {
            stdout: 'Safe fixture: preview only. No Docker commands executed.',
            stderr: ''
          },
          result: JSON.stringify({
            status: 'available',
            value: { mode: 'dry-run', removed: [] }
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
      await expect(
        panel.getByRole('heading', {
          name: 'Retain deployment images',
          exact: true
        })
      ).toBeVisible()
      await expect(
        panel.getByRole('button', {
          name: 'Run Run scheduled backups',
          exact: true
        })
      ).toBeDisabled()
      expect(starts).toBe(0)
      await panel
        .getByRole('button', { name: /^run-scheduled-backups/ })
        .click()
      await expect(panel.getByLabel('Instance run detail')).toContainText(
        'Safe fixture: processing backup 2 of 3'
      )
      const output = path.resolve('output/bosun-quest')
      fs.mkdirSync(output, { recursive: true })
      for (const [width, theme] of [
        [1440, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 1100 })
        await page.raw.emulateMedia({ colorScheme: theme })
        await panel.screenshot({
          path: path.join(output, `instance-jobs-${width}-${theme}.png`),
          animations: 'disabled'
        })
        expect(
          await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true)
      }
      await panel
        .getByRole('button', {
          name: 'Run Retain deployment images',
          exact: true
        })
        .click()
      const review = panel.locator('[data-test="confirm-modal"]')
      await expect(review).toBeVisible()
      expect(starts).toBe(0)
      await review.getByRole('button', { name: 'Run job', exact: true }).click()
      await expect(review).not.toBeVisible()
      await expect(panel.getByLabel('Instance run detail')).toContainText(
        'Safe fixture: preview only'
      )
      expect(starts).toBe(1)
      await panel.screenshot({
        path: path.join(output, 'instance-preview-mobile-dark.png'),
        animations: 'disabled'
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.instanceQuest = previous
    }
  }
)
