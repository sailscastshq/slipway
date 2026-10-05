const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')
const { withCsrfFromPage } = require('../../../support/csrf-request')

test(
  'Inertia connection saves retain failures, suppress duplicate submissions, clear secrets and preserve history',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'inertia-cleanup-ui' } }
    }
  },
  async ({ sails, world, request, login, page, expect }) => {
    const base = '/projects/inertia-cleanup-ui/environments/production'
    const csrf = await withCsrfFromPage(request, '/', 'genesisUser')
    const created = await csrf.request
      .withHeaders({ 'X-Inertia': '' })
      .post('/api/v1' + base + '/services/external', {
        name: 'external-fixture',
        configuration: {
          dsn: 'postgresql://user:fixture-initial@database.example.test/app'
        }
      })
    expect(created).toHaveStatus(201)
    const id = created.data.service.id
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    const target = `${base}/services/${id}`
    await page.goto(target)
    const panel = page.raw.locator('[data-test="external-database-status"]')
    const input = panel.locator('#external-postgres-dsn')
    await panel
      .getByRole('button', { name: 'Edit connection', exact: true })
      .click()
    await input.fill('invalid')
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('PostgreSQL')
    await expect(input).toHaveValue('invalid')
    const endpoint = `**/api/v1/services/${id}/external`
    await input.fill(
      'postgresql://user:fixture-rotated@database.example.test/app'
    )
    await page.raw.route(endpoint, (route) => route.abort('failed'))
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText(
      'Connection interrupted'
    )
    await expect(input).toHaveValue(
      'postgresql://user:fixture-rotated@database.example.test/app'
    )
    await page.raw.unroute(endpoint)
    let writes = 0
    page.raw.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        request.url().endsWith(`/services/${id}/external`)
      ) {
        expect(request.headers()['x-inertia']).toBe('true')
        writes++
      }
    })
    const historyBefore = await page.raw.evaluate(() => history.length)
    await panel.locator('form').evaluate((form) => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })
    await expect(
      panel.getByRole('button', { name: 'Edit connection', exact: true })
    ).toBeVisible()
    expect(writes).toBe(1)
    expect(await page.raw.evaluate(() => history.length)).toBe(historyBefore)
    expect(new URL(page.raw.url()).pathname).toBe(target)
    expect(
      (await sails.models.service.findOne({ id }).decrypt()).externalConnection
        .password
    ).toBe('fixture-rotated')
    await panel
      .getByRole('button', { name: 'Edit connection', exact: true })
      .click()
    await expect(input).toHaveValue('')
    await expect(panel.locator('#external-postgres-ca')).toHaveValue('')
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
    const staleApp = await world.create('app').with({
      name: 'Stale selection',
      slug: 'stale-selection',
      environment: world.current.environments.production.id
    })
    const customService = await world.create('service').with({
      name: 'custom-fixture',
      type: 'custom',
      status: 'running',
      environment: world.current.environments.production.id,
      internalHost: 'custom-fixture',
      internalPort: 8080,
      customState: { appIds: [], linkPrefix: 'CUSTOM_FIXTURE' }
    })
    await page.goto(`${base}/services/${customService.id}`)
    const customPanel = page.raw.locator('[data-test="custom-service-status"]')
    await customPanel
      .getByRole('button', { name: 'Connect apps', exact: true })
      .click()
    const checkbox = customPanel
      .locator('label')
      .filter({ hasText: 'Stale selection' })
      .getByRole('checkbox')
    await checkbox.check()
    await sails.models.app.destroyOne({ id: staleApp.id })
    await customPanel
      .getByRole('button', { name: 'Save connections', exact: true })
      .click()
    await expect(customPanel.getByRole('alert')).toContainText(
      'Choose apps from this environment'
    )
    await expect(checkbox).toBeChecked()
    expect(
      (await sails.models.service.findOne({ id: customService.id })).customState
        .appIds
    ).toEqual([])
    await page.goto(target)
    const output = path.resolve('output/inertia-cleanup')
    await fs.mkdir(output, { recursive: true })
    await page.screenshot(path.join(output, 'confirmed-connection.png'), {
      animations: 'disabled'
    })
    await page.goto(`${base}/apps/web?flags=1`)
    const key = page.raw.getByRole('textbox', {
      name: 'Release flag key',
      exact: true
    })
    await key.fill('inertia-flag')
    await key.press('Enter')
    await expect(key).toHaveValue('')
    await expect(
      page.raw.locator('[data-test="release-flag-inertia-flag"]')
    ).toBeVisible()
    await key.fill('inertia-flag')
    await key.press('Enter')
    await expect(
      page.raw.getByText('A release flag with this key already exists', {
        exact: true
      })
    ).toBeVisible()
    await expect(key).toHaveValue('inertia-flag')
    expect(
      await sails.models.featureflag.count({
        key: 'inertia-flag',
        app: world.current.apps.web.id
      })
    ).toBe(1)
    await page.screenshot(path.join(output, 'flag-validation.png'), {
      animations: 'disabled'
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'Inertia public votes keep optimistic rollback, confirmation announcements and one request per submission',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'inertia-vote-ui' } }
    }
  },
  async ({ sails, world, page, expect }) => {
    const app = world.current.apps.web
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ bearingEnabled: true })
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'inertia-vote-fixture',
        app: app.id,
        createdBy: world.current.users.genesisUser.id,
        allowAnonymousParticipation: true
      })
      .fetch()
    const feedback = await sails.models.bearingfeedback
      .create({
        title: 'Vote fixture',
        details: 'Public vote verification',
        app: app.id,
        space: space.id
      })
      .fetch()
    const hostPath = '/_slipway/bearing/host/inertia-vote-ui/production/web'
    await page.raw.route('**/bearing/**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/bearing/')) {
        url.pathname = hostPath + url.pathname.slice('/bearing'.length)
        await route.continue({ url: url.toString() })
      } else await route.continue()
    })
    await page.raw.route('**/_slipway/bearing/_assets/**', async (route) => {
      const url = new URL(route.request().url())
      url.pathname = url.pathname.replace('/_slipway/bearing/_assets', '')
      await route.continue({ url: url.toString() })
    })
    await page.goto(hostPath + '/feedback')
    const vote = page.raw
      .locator(`#bearing-feedback-${feedback.publicId}`)
      .getByRole('button')
      .first()
    const endpoint = '**/feedback/' + feedback.publicId + '/vote'
    await page.raw.route(endpoint, (route) => route.abort('failed'))
    await vote.click()
    await expect(
      page.raw.getByText('Your vote could not be saved. Try again.', {
        exact: true
      })
    ).toHaveCount(1)
    await expect(vote).toHaveAttribute('aria-pressed', 'false')
    await expect(vote).toContainText('0')
    expect(
      await sails.models.bearingvote.count({ feedback: feedback.id })
    ).toBe(0)
    await page.raw.unroute(endpoint)
    // Browser routing does not intercept the follow-up URL of a redirect.
    // Simulate the deployed app's /bearing proxy on the redirect as well.
    await page.raw.route(endpoint, async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/bearing/'))
        url.pathname = hostPath + url.pathname.slice('/bearing'.length)
      const response = await route.fetch({
        url: url.toString(),
        maxRedirects: 0
      })
      const headers = response.headers()
      if (headers.location?.startsWith('/bearing/'))
        headers.location = hostPath + headers.location.slice('/bearing'.length)
      await route.fulfill({ response, headers })
    })

    let writes = 0
    page.raw.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/vote')) {
        expect(request.headers()['x-inertia']).toBe('true')
        writes++
      }
    })
    await vote.evaluate((button) => {
      button.click()
      button.click()
    })
    await expect(
      page.raw.getByText('Vote added.', { exact: true })
    ).toHaveCount(1)
    await expect(vote).toHaveAttribute('aria-pressed', 'true')
    await expect(vote).toContainText('1')
    expect(writes).toBe(1)
    await vote.click()
    await expect(
      page.raw.getByText('Vote removed.', { exact: true })
    ).toHaveCount(1)
    await expect(vote).toContainText('0')
    expect(
      await sails.models.bearingvote.count({ feedback: feedback.id })
    ).toBe(0)
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'failed Inertia flag edits preserve all dirty values and domain saves retain only verified route evidence',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'inertia-recovery-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const flag = await sails.models.featureflag
      .create({
        key: 'recovery',
        description: 'Original description',
        app: current.apps.web.id,
        environment: current.environments.production.id
      })
      .fetch()
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    const appPath =
      '/projects/inertia-recovery-ui/environments/production/apps/web'
    await page.goto(appPath + '?flags=1')
    const row = page.raw.locator('[data-test="release-flag-recovery"]')
    await row.getByLabel('Release flag settings', { exact: true }).click()
    const description = row.getByLabel('Description', { exact: true })
    const rollout = row.getByRole('slider')
    const allowlist = row.getByLabel('Allowlist', { exact: true })
    await description.fill('Unsaved description')
    await rollout.fill('35')
    await allowlist.fill('invalid-target')
    await row.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      page.raw.getByText(/Use typed targets such as user:42/)
    ).toBeVisible()
    await expect(description).toHaveValue('Unsaved description')
    await expect(rollout).toHaveValue('35')
    await expect(allowlist).toHaveValue('invalid-target')
    await fs.mkdir(path.resolve('output/inertia-cleanup'), { recursive: true })
    await page.screenshot(
      path.resolve('output/inertia-cleanup/flag-dirty-validation.png'),
      { animations: 'disabled' }
    )
    expect(
      (await sails.models.featureflag.findOne({ id: flag.id })).description
    ).toBe('Original description')
    await allowlist.fill('user:42')
    await row.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(row.locator('details')).not.toHaveAttribute('open', '')
    const saved = await sails.models.featureflag.findOne({ id: flag.id })
    expect(saved.description).toBe('Unsaved description')
    expect(saved.rolloutPercentage).toBe(35)
    expect(saved.targets).toEqual(['user:42'])
    const originalRoute = sails.helpers.caddy.updateRoute
    const originalFinish = sails.helpers.caddy.finishRouteUpdate
    sails.helpers.caddy.updateRoute = {
      with: async () => ({ transaction: { fixture: true } })
    }
    sails.helpers.caddy.finishRouteUpdate = { with: async () => {} }
    try {
      async function openDomain() {
        await page.raw.getByRole('button', { name: 'Open app actions' }).click()
        await page.raw
          .getByRole('menuitem', { name: 'Custom domain', exact: true })
          .click()
      }
      await openDomain()
      const dialog = page.raw.getByRole('dialog', {
        name: 'Environment domain'
      })
      await dialog
        .getByRole('textbox', { name: 'Hostname' })
        .fill('verified-route.example.test')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await openDomain()
      await expect(dialog).toContainText('Verified at last save')
      await page.screenshot(
        path.resolve('output/inertia-cleanup/domain-route-receipt.png'),
        { animations: 'disabled' }
      )
      await expect(dialog).toContainText('Not verified')
      await expect(
        dialog.getByText('DNS / TLS:', { exact: true }).locator('..')
      ).toContainText('Not verified')
    } finally {
      sails.helpers.caddy.updateRoute = originalRoute
      sails.helpers.caddy.finishRouteUpdate = originalFinish
    }
    expect(page).toHaveNoJavascriptErrors()
  }
)
