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
    for (const job of jobs) {
      job.paused = false
      job.withoutOverlapping = true
    }
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
      const workspace = panel.getByRole('tablist', { name: 'Quest workspace' })
      const jobDetail = panel.locator('[data-test="quest-job-detail"]')
      const runDetail = panel.locator('[data-test="quest-run-detail"]')
      const cleanupRun = panel.getByRole('button', {
        name: 'Run Clean up deployment images',
        exact: true
      })
      await expect(cleanupRun).toBeEnabled()
      await expect(
        panel.getByRole('button', {
          name: 'Run Run scheduled backups',
          exact: true
        })
      ).toBeDisabled()
      await expect(
        panel.locator('[data-test="instance-job-caret"]')
      ).toHaveCount(0)
      await panel
        .getByRole('searchbox', { name: 'Search jobs' })
        .fill('observability')
      await expect(panel.locator('[data-test="quest-job-row"]')).toHaveCount(1)
      await panel.getByRole('searchbox', { name: 'Search jobs' }).fill('')
      const stateSelect = panel.getByRole('combobox', {
        name: 'Filter jobs by state'
      })
      await stateSelect.click()
      await page.raw
        .getByRole('option', { name: 'Running', exact: true })
        .click()
      await expect(panel.locator('[data-test="quest-job-row"]')).toHaveCount(1)
      await stateSelect.click()
      await page.raw
        .getByRole('option', { name: 'All states', exact: true })
        .click()
      await expect(panel.locator('[data-test="quest-job-row"]')).toHaveCount(
        jobs.length
      )
      const openJob = (name) =>
        panel.getByRole('button', { name: `View ${name}`, exact: true })
      const shot = async (name) => {
        await page.raw.evaluate(() => document.fonts.ready)
        expect(
          await panel.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1
          )
        ).toBe(true)
        await page.raw.screenshot({
          path: path.join(output, name + '.png'),
          fullPage: true,
          animations: 'disabled'
        })
      }
      for (const width of [1440, 390])
        for (const theme of ['light', 'dark']) {
          await page.raw.setViewportSize({ width, height: 1100 })
          await page.raw.emulateMedia({ colorScheme: theme })
          await panel
            .getByRole('heading', { name: 'Instance jobs', exact: true })
            .scrollIntoViewIfNeeded()
          await shot(`shared-jobs-${width}-${theme}`)
          await openJob('Clean up deployment images').focus()
          await page.raw.keyboard.press('Enter')
          await expect(jobDetail).toBeVisible()
          await expect(
            jobDetail.getByRole('tab', { name: 'Runs', exact: true })
          ).toHaveAttribute('aria-selected', 'true')
          await shot(`shared-job-runs-${width}-${theme}`)
          await jobDetail
            .getByRole('tab', { name: 'Schedule', exact: true })
            .click()
          await expect(jobDetail).toContainText('UTC')
          await expect(jobDetail).toContainText(
            'Schedule defined in Slipway source.'
          )
          await expect(
            jobDetail.getByRole('button', { name: 'Pause job', exact: true })
          ).toBeDisabled()
          await shot(`shared-schedule-${width}-${theme}`)
          await jobDetail
            .getByRole('tab', { name: 'Inputs', exact: true })
            .click()
          await expect(jobDetail.getByRole('textbox')).toHaveCount(0)
          await jobDetail
            .getByRole('tab', { name: 'Runs', exact: true })
            .click()
          await jobDetail.locator('[data-test="quest-run-row"]').click()
          await expect(
            runDetail.locator('[data-test="quest-run-result"]')
          ).toContainText('dry-run')
          await runDetail
            .getByRole('tab', { name: 'Logs', exact: true })
            .click()
          await expect(
            runDetail.locator('[data-test="quest-run-logs"]')
          ).toContainText('2 candidates, 0 removed')
          await shot(`shared-run-logs-${width}-${theme}`)
          await jobDetail
            .getByRole('button', { name: 'Close job details', exact: true })
            .click()
        }
      await page.raw.setViewportSize({ width: 1440, height: 1100 })
      await openJob('Run scheduled backups').click()
      await jobDetail
        .getByRole('button', {
          name: /Open run: Run scheduled backups, running/
        })
        .click()
      await runDetail.getByRole('tab', { name: 'Logs', exact: true }).click()
      await expect(runDetail).toContainText(
        'Safe fixture: processing backup 2 of 3'
      )
      runs[0].logs.stdout += '\nSafe fixture: live output refreshed'
      await expect(runDetail).toContainText(
        'Safe fixture: live output refreshed'
      )
      await expect(
        runDetail.getByRole('button', { name: 'Cancel run', exact: true })
      ).toHaveCount(0)
      await runDetail
        .getByRole('button', { name: 'Close run details', exact: true })
        .click()
      await jobDetail
        .getByRole('button', {
          name: /Open run: Run scheduled backups, failed/
        })
        .click()
      await expect(runDetail).toContainText(
        'Safe fixture: backup destination unavailable'
      )
      await runDetail.getByRole('tab', { name: 'Logs', exact: true }).click()
      await expect(runDetail).toContainText(
        'Safe fixture: retry after checking destination'
      )
      await expect(runDetail).toContainText('truncated')
      await shot('shared-failed-run-desktop-dark')
      await jobDetail
        .getByRole('button', { name: 'Close job details', exact: true })
        .click()
      await panel.getByRole('tab', { name: 'Runs', exact: true }).click()
      await expect(
        panel.locator('[data-test="quest-history-scope"]')
      ).toHaveText('Last 100 retained instance runs')
      await expect(panel.locator('[data-test="quest-run-row"]')).toHaveCount(3)
      await panel.getByRole('tab', { name: /^Jobs/ }).click()
      expect(starts).toBe(0)
      await cleanupRun.click()
      const review = panel.locator('[data-test="confirm-modal"]')
      await expect(review).toBeVisible()
      await expect(review).toContainText(
        'Remove eligible old deployment images now'
      )
      await page.raw.keyboard.press('Escape')
      await expect(review).not.toBeVisible()
      expect(starts).toBe(0)
      await cleanupRun.click()
      await review
        .getByRole('button', { name: 'Clean up', exact: true })
        .click()
      await expect(review).not.toBeVisible()
      await expect(runDetail).toBeVisible()
      await runDetail.getByRole('tab', { name: 'Logs', exact: true }).click()
      await expect(runDetail).toContainText('Safe fixture: cleanup complete')
      expect(starts).toBe(1)
      expect(requests).toEqual([{}])
      await runDetail
        .getByRole('button', { name: 'Run again', exact: true })
        .click()
      await expect(review).toBeVisible()
      await review.getByRole('button', { name: 'Cancel', exact: true }).click()
      jobs[0].cleanupEnabled = false
      await expect(
        jobDetail.getByRole('button', {
          name: 'Run Clean up deployment images',
          exact: true
        })
      ).toBeDisabled()
      await jobDetail
        .getByRole('button', { name: 'Close job details', exact: true })
        .click()
      await expect(cleanupRun).toBeDisabled()
      await page.raw.route('**/api/v1/bosun/quest', (route) =>
        route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      )
      await panel.getByRole('button', { name: 'Refresh instance jobs' }).click()
      await expect(panel.getByRole('alert')).toContainText(
        'Could not load instance jobs'
      )
      await expect(
        panel.getByRole('button', {
          name: 'Run Maintain observability',
          exact: true
        })
      ).toBeDisabled()
      await shot('shared-unavailable-desktop-dark')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      await page.raw.goto('about:blank')
      sails.instanceQuest = previous
    }
  }
)
