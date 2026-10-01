const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
test(
  'Dock backup history guides a restore test and keeps its report after returning',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'dock-backups' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const service = await world.create('service').with({
      environment: current.environments.production.id,
      name: 'primary-db',
      type: 'postgresql',
      version: '15',
      status: 'running',
      database: 'app'
    })
    const root = path.resolve('.tmp/screenshots/652')
    fs.mkdirSync(root, { recursive: true })
    let mode = 'idle',
      starts = 0
    const completedAt = Date.now()
    const backup = {
      id: 42,
      status: 'completed',
      type: 'scheduled',
      createdAt: completedAt - 3600000,
      sizeBytes: 5242880,
      storage: { container: 'slipway-backups' }
    }
    const operation = () =>
      mode === 'idle'
        ? null
        : {
            id: 7,
            backup: 42,
            status:
              mode === 'running'
                ? 'running'
                : mode === 'cleanup'
                ? 'completed'
                : mode === 'failed'
                ? 'failed'
                : 'completed',
            stage:
              mode === 'running'
                ? 'verifying'
                : mode === 'cleanup'
                ? 'cleanup_pending'
                : mode === 'failed'
                ? 'failed'
                : 'completed',
            completedAt: mode === 'running' ? null : completedAt,
            error:
              mode === 'failed'
                ? 'Could not verify the downloaded backup. Check backup storage access and the recorded file size/checksum.'
                : '',
            cleanupPending: mode === 'cleanup',
            report:
              mode === 'running' || mode === 'failed'
                ? {}
                : {
                    checks: [
                      'Recorded file size matches',
                      'SHA-256 checksum verified',
                      'PostgreSQL import completed without errors',
                      'Database connectivity verified',
                      'All 3 restored base tables are readable'
                    ],
                    serverVersion: '15.17',
                    compatibility: 'Backup-time image',
                    cleanup: mode === 'cleanup' ? 'needs_attention' : 'removed'
                  }
          }
    await page.raw.route(
      `**/api/v1/services/${service.id}/backups?*`,
      (route) =>
        route.fulfill({
          json: {
            backups: [
              { ...backup, restoreTest: operation() },
              {
                id: 41,
                status: 'completed',
                type: 'manual',
                createdAt: completedAt - 86400000,
                sizeBytes: 4000000,
                storage: { container: 'slipway-backups' }
              }
            ],
            testSupported: true,
            testLimits: {
              maxBytes: 67108864,
              memoryBytes: 536870912,
              dataBytes: 268435456
            },
            hasMore: false
          }
        })
    )
    await page.raw.route('**/api/v1/backups/42/test-restore', (route) => {
      starts++
      mode = 'running'
      return route.fulfill({ status: 202, json: { test: operation() } })
    })
    await page.raw.route('**/api/v1/restore-tests/7/action', (route) => {
      mode = 'complete'
      return route.fulfill({ json: { success: true } })
    })
    await page.raw.route('**/dock/tables?*', (route) =>
      route.fulfill({ json: { tables: [] } })
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    const url = `/projects/dock-backups/environments/production/dock/${service.id}?tab=backups&backup=42`
    await page.goto(url)
    await expect(
      page.raw.getByRole('heading', { name: 'Backups', exact: true })
    ).toBeVisible()
    await expect(
      page.raw.getByText('Not tested yet.', { exact: false })
    ).toBeVisible()
    await page.screenshot(path.join(root, 'history-light.png'))
    await page.raw
      .getByRole('button', { name: 'Test restore', exact: true })
      .click()
    await expect(page.raw.getByRole('dialog')).toContainText(
      'Your running database stays unchanged'
    )
    await page.screenshot(path.join(root, 'start-test-light.png'))
    await page.raw
      .getByRole('button', { name: 'Start test', exact: true })
      .click()
    await expect(
      page.raw.getByRole('heading', { name: 'Verifying data', exact: true })
    ).toBeVisible()
    expect(starts).toBe(1)
    await expect(
      page.raw.getByRole('button', { name: 'Cancel test' })
    ).toBeVisible()
    await page.screenshot(path.join(root, 'running-light.png'))
    mode = 'complete'
    await page.raw.getByRole('button', { name: 'Refresh backups' }).click()
    await expect(
      page.raw.getByRole('heading', { name: 'Restore verified', exact: true })
    ).toBeVisible()
    await expect(
      page.raw
        .getByRole('tabpanel', { name: 'backups' })
        .getByText('Temporary database removed.', { exact: true })
    ).toBeVisible()
    await expect(
      page.raw
        .locator('[data-slot="toast"]')
        .filter({ hasText: 'Backup restoration verified' })
    ).toBeVisible()
    await page.raw.waitForTimeout(300)
    await page.screenshot(path.join(root, 'verified-light.png'))
    await page.raw.getByRole('tab', { name: 'Tables', exact: false }).click()
    await page.raw.getByRole('tab', { name: 'Backups', exact: false }).click()
    await expect(
      page.raw.getByRole('heading', { name: 'Restore verified', exact: true })
    ).toBeVisible()
    mode = 'failed'
    await page.raw.getByRole('button', { name: 'Refresh backups' }).click()
    await expect(
      page.raw.getByRole('heading', { name: 'Test failed', exact: true })
    ).toBeVisible()
    await page.screenshot(path.join(root, 'failed-light.png'))
    mode = 'cleanup'
    await page.raw.getByRole('button', { name: 'Refresh backups' }).click()
    await expect(
      page.raw.getByRole('button', { name: 'Retry cleanup' })
    ).toBeVisible()
    await page.raw.getByRole('button', { name: 'Retry cleanup' }).click()
    await expect(
      page.raw
        .getByRole('tabpanel', { name: 'backups' })
        .getByText('Temporary database removed.', { exact: true })
    ).toBeVisible()
    await page.raw.setViewportSize({ width: 390, height: 844 })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw.waitForTimeout(300)
    const notifications = page.raw.locator(
      '[data-slot="toast"]:not([data-state="closing"]) button'
    )
    while (await notifications.count()) await notifications.first().click()
    await page.raw.waitForTimeout(300)
    await page.screenshot(path.join(root, 'verified-mobile-dark.png'))
    expect(
      await page.raw.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
)

test(
  'Dock starts one durable backup and restore test when no backup exists',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'dock-empty-backups' } }
    }
  },
  async ({ world, login, page, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'primary-db',
      type: 'postgresql',
      version: '15',
      status: 'running'
    })
    let queued = false,
      requests = 0
    await page.raw.route(
      `**/api/v1/services/${service.id}/backups?*`,
      (route) =>
        route.fulfill({
          json: {
            backups: queued
              ? [
                  {
                    id: 44,
                    status: 'running',
                    type: 'manual',
                    createdAt: Date.now(),
                    restoreTest: { id: 8, status: 'running', stage: 'backup' }
                  }
                ]
              : [],
            testSupported: true,
            testLimits: {
              maxBytes: 67108864,
              memoryBytes: 536870912,
              dataBytes: 268435456
            },
            hasMore: false
          }
        })
    )
    await page.raw.route(
      `**/api/v1/services/${service.id}/backups/test-restore`,
      (route) => {
        queued = true
        requests++
        return route.fulfill({
          status: 202,
          json: {
            test: { id: 8, backup: 44, status: 'queued', stage: 'queued' }
          }
        })
      }
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto(
      `/projects/dock-empty-backups/environments/production/dock/${service.id}?tab=backups`
    )
    await expect(
      page.raw.getByRole('heading', { name: 'No backups yet' })
    ).toBeVisible()
    await page.raw
      .getByRole('button', { name: 'Back up and test restore' })
      .click()
    await expect(page.raw.getByRole('dialog')).toContainText(
      'Create a backup and restore it'
    )
    await page.raw
      .getByRole('button', { name: 'Start test', exact: true })
      .click()
    await expect(
      page.raw.getByRole('heading', { name: 'Creating backup' })
    ).toBeVisible()
    expect(requests).toBe(1)
    expect(page.raw.url()).toContain('backup=44')
  }
)
