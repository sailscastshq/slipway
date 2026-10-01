const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')

test(
  'manual backups show progress and truthful terminal toasts',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'backup-feedback' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    await sails.helpers.setting.set(
      'backupStorageConfig',
      JSON.stringify({
        provider: 's3',
        bucket: 'private-backups',
        region: 'auto',
        endpoint: 'https://account.r2.cloudflarestorage.com',
        key: 'fixture',
        secret: 'fixture'
      })
    )
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'Customer database',
      status: 'running',
      containerName: 'backup-feedback-db',
      internalHost: 'backup-feedback-db',
      internalPort: 5432,
      database: 'app',
      username: 'postgres'
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    let streamStarted
    let streamReady
    let finishStream
    let status = 'completed'
    let requests = 0
    await page.raw.route(
      `**/api/v1/services/${service.id}/backups`,
      (route) => {
        requests++
        return route.fulfill({
          status: 200,
          json: { backup: { id: `fixture-backup-${requests}` } }
        })
      }
    )
    await page.raw.route(
      '**/api/v1/backups/fixture-backup-*/stream',
      async (route) => {
        streamStarted()
        await new Promise((resolve) => {
          finishStream = resolve
        })
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ status })}\n\n`
        })
      }
    )
    await page.goto(
      '/projects/backup-feedback/environments/production?services'
    )
    const button = page.raw.getByRole('button', {
      name: 'Backup now',
      exact: true
    })
    const toast = page.raw.locator(
      '[data-slot="toast"]:not([data-state="closing"])'
    )
    const output = path.resolve('.tmp/screenshots/650')
    await fs.mkdir(output, { recursive: true })
    await page.resize(1280, 1000)
    await button.scrollIntoViewIfNeeded()
    await page.screenshot(path.join(output, 'backup-now.png'), {
      animations: 'disabled'
    })
    for (const terminal of ['completed', 'failed']) {
      status = terminal
      streamReady = new Promise((resolve) => {
        streamStarted = resolve
      })
      await button.click()
      const busy = page.raw.getByRole('button', {
        name: 'Backing up…',
        exact: true
      })
      await expect(busy).toBeDisabled()
      await expect(busy).toHaveAttribute('aria-busy', 'true')
      await expect(toast).toContainText('Backup queued for Customer database')
      await expect(toast).not.toContainText('Backup completed')
      await page.screenshot(
        path.join(output, `backup-${terminal}-pending.png`),
        { animations: 'disabled' }
      )
      await streamReady
      finishStream()
      finishStream = undefined
      await expect(toast).toContainText(
        terminal === 'completed' ? 'Backup completed' : 'Backup failed.'
      )
      await expect(button).toBeEnabled()
      await page.screenshot(path.join(output, `backup-${terminal}.png`), {
        animations: 'disabled'
      })
      await toast.locator('button').click()
    }
    expect(requests).toBe(2)
    await page.raw.unroute('**/api/v1/backups/fixture-backup-*/stream')
    await page.raw.route('**/api/v1/backups/fixture-backup-*/stream', (route) =>
      route.fulfill({ status: 503, body: 'Status stream unavailable' })
    )
    await button.click()
    await expect(toast).toContainText('Backup status connection interrupted')
    await expect(button).toBeEnabled()
    await toast.locator('button').click()
    await page.raw.unroute(`**/api/v1/services/${service.id}/backups`)
    await page.raw.route(`**/api/v1/services/${service.id}/backups`, (route) =>
      route.fulfill({ status: 403, json: { message: 'Denied' } })
    )
    await button.click()
    await expect(toast).toContainText('You no longer have permission')
    await expect(button).toBeEnabled()
    expect(page).toHaveNoJavascriptErrors()
  }
)
