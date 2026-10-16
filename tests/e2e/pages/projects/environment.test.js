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
    const menuTrigger = page.raw.getByRole('button', {
      name: 'Backup options for Customer database',
      exact: true
    })
    const menu = page.raw.getByRole('menu', {
      name: 'Backup options for Customer database',
      exact: true
    })
    const openMenu = async () => {
      if (!(await menu.isVisible())) await menuTrigger.click()
    }
    await openMenu()
    const button = page.raw.getByRole('menuitem', {
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
    await expect(button).toHaveCSS('outline-style', 'none')
    await button.screenshot({
      path: path.join(output, 'label-idle.png'),
      animations: 'disabled'
    })
    await page.screenshot(path.join(output, 'backup-now.png'), {
      animations: 'disabled'
    })
    for (const terminal of ['completed', 'failed']) {
      status = terminal
      streamReady = new Promise((resolve) => {
        streamStarted = resolve
      })
      await openMenu()
      await button.click()
      await openMenu()
      const busy = page.raw.getByRole('menuitem', {
        name: 'Backup now',
        exact: true
      })
      await expect(busy).toBeDisabled()
      await expect(busy).toHaveAttribute('aria-busy', 'true')
      await expect(toast).toContainText('Backup queued for Customer database')
      await expect(toast).not.toContainText('Backup completed')
      await busy.screenshot({
        path: path.join(output, 'label-busy.png'),
        animations: 'disabled'
      })
      await page.screenshot(
        path.join(output, `backup-${terminal}-pending.png`),
        { animations: 'disabled' }
      )
      await streamReady
      finishStream()
      finishStream = undefined
      await expect(toast).toContainText(
        terminal === 'completed' ? 'Backup completed' : 'Backup failed'
      )
      await openMenu()
      await expect(button).toBeEnabled()
      await toast.screenshot({
        path: path.join(output, `label-${terminal}.png`),
        animations: 'disabled'
      })
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
    await openMenu()
    await button.click()
    await expect(toast).toContainText('Backup status connection interrupted')
    await toast.screenshot({
      path: path.join(output, 'label-interrupted.png'),
      animations: 'disabled'
    })
    await openMenu()
    await expect(button).toBeEnabled()
    await page.screenshot(path.join(output, 'backup-interrupted.png'), {
      animations: 'disabled'
    })
    await toast.locator('button').click()
    await page.raw.unroute(`**/api/v1/services/${service.id}/backups`)
    await page.raw.route(`**/api/v1/services/${service.id}/backups`, (route) =>
      route.fulfill({ status: 403, json: { message: 'Denied' } })
    )
    await openMenu()
    await button.click()
    await expect(toast).toContainText('You no longer have permission')
    await toast.screenshot({
      path: path.join(output, 'label-denied.png'),
      animations: 'disabled'
    })
    await openMenu()
    await expect(button).toBeEnabled()
    await page.screenshot(path.join(output, 'backup-denied.png'), {
      animations: 'disabled'
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'configuration secrets are absent from page props and only revealed by an audited request',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'explicit-secret-reveal' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const secret = 'browser-canary-718-secret'
    await sails.models.environment
      .updateOne({ id: world.current.environments.production.id })
      .set({ envVars: { UNUSUAL: secret }, envVarMetadata: {} })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto(
      '/projects/explicit-secret-reveal/environments/production?env'
    )
    const variables = page.raw
      .getByRole('button', { name: 'Environment variables', exact: false })
      .first()
    const input = page.raw.getByRole('textbox', { name: 'UNUSUAL value' })
    if (!(await page.raw.locator('[aria-label="UNUSUAL value"]').isVisible()))
      await variables.click()
    const hidden = page.raw.locator('[aria-label="UNUSUAL value"]')
    await expect(hidden).toHaveValue('[REDACTED]')
    const response = page.raw.waitForResponse((response) =>
      response.url().endsWith('/api/v1/configuration/reveal')
    )
    await page.raw
      .getByRole('button', { name: 'Reveal UNUSUAL', exact: true })
      .click()
    expect((await response).status()).toBe(200)
    await expect(input).toHaveValue(secret)
    await page.raw
      .getByRole('button', { name: 'Hide UNUSUAL', exact: true })
      .click()
    await expect(hidden).toHaveValue('[REDACTED]')
    await expect(hidden).toHaveAttribute('type', 'password')
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'backup row groups actions and retains the last success after a failed attempt',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'backup-row-review' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'FLOSSAfrica database',
      status: 'running',
      containerName: 'fixture-backup-row',
      internalHost: 'fixture-backup-row',
      internalPort: 5432,
      database: 'db',
      username: 'postgres'
    })
    await sails.helpers.setting.set(
      'backupStorageConfig',
      JSON.stringify({
        provider: 's3',
        bucket: 'fixture-private',
        region: 'auto',
        endpoint: 'https://fixture.invalid',
        key: 'fixture',
        secret: 'fixture'
      })
    )
    await Backup.create({
      service: service.id,
      status: 'completed',
      type: 'manual',
      createdAt: Date.now() - 14 * 86400000,
      completedAt: Date.now() - 14 * 86400000,
      sizeBytes: 76698
    })
    await Backup.create({
      service: service.id,
      status: 'failed',
      type: 'scheduled',
      completedAt: Date.now(),
      errorMessage: 'Fixture failure'
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto(
      '/projects/backup-row-review/environments/production?services'
    )
    const row = page.raw.locator('[data-backup-row]')
    await expect(row).toContainText('Last successful backup')
    await expect(row).toContainText('74.9 KB')
    await expect(row).not.toContainText('Latest attempt failed')
    await expect(row).not.toContainText('Backing up')
    const trigger = row.getByRole('button', {
      name: 'Backup options for FLOSSAfrica database',
      exact: true
    })
    await trigger.click()
    const menu = page.raw.getByRole('menu', {
      name: 'Backup options for FLOSSAfrica database',
      exact: true
    })
    await expect(
      menu.getByRole('menuitem', { name: 'Backup now', exact: true })
    ).toBeEnabled()
    await expect(
      menu.getByRole('menuitem', { name: 'Backups', exact: true })
    ).toBeVisible()
    await page.raw.keyboard.press('Escape')
    const output = path.resolve('.tmp/screenshots/780')
    await fs.mkdir(output, { recursive: true })
    for (const [theme, width] of [
      ['dark', 1280],
      ['light', 1280],
      ['dark', 390]
    ]) {
      await page.resize(width, 900)
      await page.raw.emulateMedia({ colorScheme: theme })
      await row.scrollIntoViewIfNeeded()
      await row.screenshot({
        path: path.join(output, `after-${theme}-${width}.png`),
        animations: 'disabled'
      })
      expect(
        await row.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true)
      await trigger.click()
      await expect(menu).toBeVisible()
      await page.raw.waitForFunction((id) => {
        const rect = document.getElementById(id)?.getBoundingClientRect()
        const anchor = document
          .querySelector(`[popovertarget="${id}"]`)
          ?.getBoundingClientRect()
        return (
          rect &&
          anchor &&
          rect.x >= 0 &&
          rect.right <= window.innerWidth &&
          Math.abs(rect.right - anchor.right) < 2
        )
      }, `backup-actions-${service.id}`)
      const focusedItem = menu.getByRole('menuitem', {
        name: 'Backup now',
        exact: true
      })
      await expect(focusedItem).toBeFocused()
      await expect(focusedItem).toHaveCSS('outline-style', 'none')
      await expect(focusedItem).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(38, 38, 38)' : 'rgb(250, 250, 250)'
      )
      const rowBox = await row.boundingBox()
      const menuBox = await menu.boundingBox()
      expect(menuBox.x >= 0 && menuBox.x + menuBox.width <= width).toBe(true)
      await page.raw.screenshot({
        path: path.join(output, `menu-${theme}-${width}.png`),
        animations: 'disabled',
        clip: {
          x: Math.min(rowBox.x, menuBox.x),
          y: Math.min(rowBox.y, menuBox.y),
          width:
            Math.max(rowBox.x + rowBox.width, menuBox.x + menuBox.width) -
            Math.min(rowBox.x, menuBox.x),
          height:
            Math.max(rowBox.y + rowBox.height, menuBox.y + menuBox.height) -
            Math.min(rowBox.y, menuBox.y)
        }
      })
      await page.raw.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      await expect(trigger).toHaveCSS('outline-color', 'rgb(115, 115, 115)')
    }
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'backup deployment-style notification persists through running states and navigation',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'backup-toast-review' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    await sails.helpers.setting.set(
      'backupStorageConfig',
      JSON.stringify({
        provider: 's3',
        bucket: 'fixture-private',
        region: 'auto',
        endpoint: 'https://fixture.invalid',
        key: 'fixture',
        secret: 'fixture'
      })
    )
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'FLOSSAfrica database',
      status: 'running',
      containerName: 'fixture-toast',
      internalHost: 'fixture-toast',
      internalPort: 5432,
      database: 'db',
      username: 'postgres'
    })
    await Backup.create({
      service: service.id,
      type: 'manual',
      status: 'completed',
      createdAt: Date.now() - 86400000,
      completedAt: Date.now() - 86400000,
      sizeBytes: 76664
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.addInitScript(() => {
      const NativeEventSource = window.EventSource
      window.EventSource = class {
        constructor(url) {
          if (!String(url).includes('/backups/fixture-toast/stream'))
            return new NativeEventSource(url)
          window.fixtureBackupStream = this
        }
        close() {
          this.closed = true
        }
      }
    })
    let requests = 0
    await page.raw.route(
      `**/api/v1/services/${service.id}/backups`,
      (route) => {
        requests++
        return route.fulfill({
          status: 200,
          json: { backup: { id: 'fixture-toast' } }
        })
      }
    )
    await page.goto(
      '/projects/backup-toast-review/environments/production?services'
    )
    const row = page.raw.locator('[data-backup-row]')
    const trigger = row.getByRole('button', {
      name: 'Backup options for FLOSSAfrica database',
      exact: true
    })
    const menu = page.raw.getByRole('menu', {
      name: 'Backup options for FLOSSAfrica database',
      exact: true
    })
    const notification = page.raw.locator('[data-backup-notification]')
    const output = path.resolve('.tmp/screenshots/780')
    await fs.mkdir(output, { recursive: true })
    await trigger.click()
    await menu
      .getByRole('menuitem', { name: 'Backup now', exact: true })
      .click()
    await expect(notification).toHaveAttribute('data-backup-status', 'pending')
    await page.raw.waitForFunction(() => window.fixtureBackupStream)
    const toastId = await notification.evaluate(
      (element) => element.closest('[data-toast-id]').dataset.toastId
    )
    await page.raw.evaluate(() =>
      window.fixtureBackupStream.onmessage({
        data: JSON.stringify({ status: 'running' })
      })
    )
    await expect(notification).toHaveAttribute('data-backup-status', 'running')
    await expect(notification).toContainText('Backing up')
    await expect(notification).not.toContainText('Backup completed')
    await expect(row).not.toContainText('Backing up')
    await expect(row).not.toContainText('Latest attempt failed')
    await trigger.click()
    const backupNow = menu.getByRole('menuitem', {
      name: 'Backup now',
      exact: true
    })
    await expect(backupNow).toBeDisabled()
    await backupNow.dispatchEvent('click')
    expect(requests).toBe(1)
    await page.raw.keyboard.press('Escape')
    for (const width of [1280, 390]) {
      await page.resize(width, 900)
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(output, `toast-running-dark-${width}.png`),
        { animations: 'disabled' }
      )
      expect(
        await notification.evaluate(
          (element) =>
            element.getBoundingClientRect().right <= window.innerWidth
        )
      ).toBe(true)
    }
    // A persistent AppLayout notification owns its stream after the page unmounts.
    await page.resize(1280, 900)
    await page.raw
      .locator('a[href="/"]:visible')
      .filter({ hasText: 'Projects' })
      .first()
      .click()
    await expect(notification).toHaveAttribute('data-backup-status', 'running')
    await page.raw.evaluate(() =>
      window.fixtureBackupStream.onmessage({
        data: JSON.stringify({ status: 'completed' })
      })
    )
    await expect(notification).toHaveAttribute(
      'data-backup-status',
      'completed'
    )
    await expect(notification).toContainText('Backup completed')
    await notification.screenshot({
      path: path.join(output, 'toast-completed.png'),
      animations: 'disabled'
    })
    expect(
      await notification.evaluate(
        (element) => element.closest('[data-toast-id]').dataset.toastId
      )
    ).toBe(toastId)
    expect(page).toHaveNoJavascriptErrors()
  }
)
