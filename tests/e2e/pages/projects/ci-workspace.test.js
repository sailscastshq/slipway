const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const runs = require('../../../fixtures/ci/source-check-runs.json')
test(
  'CI uses the actual Slipway shell and dashed Klean select without approving source-only evidence',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'ci-native-review', name: 'sailsconf.com' }
      }
    }
  },
  async ({ world, page, login, expect }) => {
    const target = `/projects/${world.current.projects.deploymentTarget.slug}/ci`
    let showRuns = false
    await page.raw.route(`**${target}*`, async (route) => {
      const response = await route.fetch()
      const source = await response.text()
      const isJson = response
        .headers()
        ['content-type']?.includes('application/json')
      const match = isJson
        ? null
        : source.match(
            /(<script[^>]*type="application\/json"[^>]*data-page="app"[^>]*>)([\s\S]*?)(<\/script>)/
          )
      const payload = JSON.parse(isJson ? source : match[2])
      if (showRuns) payload.props.workspace.runs = runs
      const json = JSON.stringify(payload)
      await route.fulfill({
        response,
        body: isJson
          ? json
          : source.replace(
              match[0],
              `${match[1]}${json.replace(/</g, '\\u003c')}${match[3]}`
            )
      })
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
    await page.goto(target)
    await expect(
      page.raw.getByRole('heading', { name: 'No checks have run yet' })
    ).toBeVisible()
    showRuns = true
    await page.raw.getByRole('button', { name: 'Refresh CI runs' }).click()
    const selected = page.raw.getByRole('article', { name: 'Selected CI run' })
    await expect(selected).toContainText(
      'Required lint, tests and build · fixed'
    )
    await expect(selected).toContainText('Not approved')
    const filter = page.raw.getByRole('combobox', {
      name: 'Filter CI runs by state'
    })
    expect(
      await filter.evaluate((el) => getComputedStyle(el).borderBottomStyle)
    ).toBe('dashed')
    await filter.focus()
    await page.raw.keyboard.press('Enter')
    await expect(page.raw.getByRole('listbox')).toBeVisible()
    await page.raw.getByRole('option', { name: 'Passed', exact: true }).click()
    await page.raw
      .getByRole('button', { name: /^Original tests and build policy/ })
      .click()
    await expect(selected).toContainText('Original tests and build policy')
    await expect(selected).toContainText(
      'An application image has not been verified'
    )
    await expect(selected).toContainText('Not approved')
    await filter.click()
    await page.raw.getByRole('option', { name: 'Failed', exact: true }).click()
    await page.raw.getByRole('button', { name: 'Refresh CI runs' }).click()
    await expect(filter).toContainText('Failed')
    await filter.evaluate((element) => element.blur())
    const output = path.resolve('.tmp/screenshots/ci-native')
    fs.mkdirSync(output, { recursive: true })
    for (const width of [1440, 390]) {
      await page.resize(width, width === 390 ? 844 : 1000)
      for (const scheme of ['light', 'dark']) {
        await page.raw.emulateMedia({
          colorScheme: scheme,
          reducedMotion: 'reduce'
        })
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true)
        await page.screenshot(
          path.join(output, `failed-${width}-${scheme}.png`),
          { fullPage: true, animations: 'disabled' }
        )
      }
    }
    await page.raw.getByRole('button', { name: 'Review checks' }).click()
    await expect(
      page.raw.getByRole('tab', { name: 'Configuration', exact: true })
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.raw.getByText('No CI policy is configured.', { exact: false })
    ).toBeVisible()
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'CI owner can revoke a runner and disable the policy with confirmation and toast feedback',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-controls-review' } }
    }
  },
  async ({ sails, world, page, login, expect }) => {
    const crypto = require('node:crypto')
    const app = world.current.apps.web
    const policy = await sails.models.cipolicy
      .create({
        app: app.id,
        revision: 'review-1',
        repositoryId: '123',
        branch: 'main',
        createdBy: world.current.users.genesisUser.id,
        enabled: true,
        configuration: {
          execution: {
            platform: 'linux/amd64',
            scripts: ['lint', 'test', 'build'].map((name) => ({
              name,
              script: `npm run ${name}`
            }))
          }
        }
      })
      .fetch()
    const runner = await sails.models.cirunner
      .create({
        app: app.id,
        runnerId: crypto.randomUUID(),
        name: 'Owner development machine',
        publicKey: 'fixture',
        policyRevision: policy.revision,
        approvedBy: world.current.users.genesisUser.id
      })
      .fetch()
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
    await page.goto(
      `/projects/${world.current.projects.deploymentTarget.slug}/ci?view=configuration`
    )
    await expect(
      page.raw.getByText('Trusted for this policy', { exact: true })
    ).toBeVisible()
    await page.raw
      .getByRole('button', { name: 'Enable automatic checks', exact: true })
      .click()
    await expect(
      page.raw.getByRole('heading', { name: 'Enable automatic CI?' })
    ).toBeVisible()
    await expect(page.raw.getByRole('dialog')).toContainText('2 CPUs and 4 GiB')
    await page.raw
      .getByRole('button', { name: 'Enable automatic CI', exact: true })
      .click()
    await expect(
      page.raw.getByText('Automatic CI enabled.', { exact: true })
    ).toBeVisible()
    await expect(
      page.raw.getByText('Normal pushes need no CI command.', { exact: false })
    ).toBeVisible()
    expect(
      (await sails.models.cipolicy.findOne({ id: policy.id })).configuration
        .automatic
    ).toBe(true)
    await page.raw.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(
      page.raw.getByRole('heading', { name: 'Revoke local runner?' })
    ).toBeVisible()
    await page.raw
      .getByRole('button', { name: 'Revoke runner', exact: true })
      .click()
    await expect(
      page.raw.getByText('Local runner revoked.', { exact: true })
    ).toBeVisible()
    await expect(page.raw.getByText('Revoked', { exact: true })).toBeVisible()
    expect(
      (await sails.models.cirunner.findOne({ id: runner.id })).revokedAt
    ).toBeTruthy()
    await page.raw
      .getByRole('button', { name: 'Disable CI', exact: true })
      .click()
    await expect(
      page.raw.getByRole('heading', { name: 'Disable CI for this app?' })
    ).toBeVisible()
    await page.raw
      .getByRole('dialog')
      .getByRole('button', { name: 'Disable CI', exact: true })
      .click()
    await expect(
      page.raw.getByText('CI policy disabled.', { exact: true })
    ).toBeVisible()
    await expect(
      page.raw.getByText('This policy is disabled.', { exact: false })
    ).toBeVisible()
    expect(
      (await sails.models.cipolicy.findOne({ id: policy.id })).enabled
    ).toBe(false)
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'deployment toast streams CI waiting and active steps without pretending the image is building',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-phase-proof' } }
    }
  },
  async ({ sails, world, page, login, expect }) => {
    const app = world.current.apps.web
    const deployment = await world.create('deployment').with({
      app: app.id,
      environment: app.environment,
      status: 'building',
      startedAt: Date.now()
    })
    const job = await sails.models.deploymentjob
      .create({
        deployment: deployment.id,
        targetKey: 'app:' + app.id,
        appSlug: app.slug,
        stage: 'ci_waiting'
      })
      .fetch()
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
    await page.goto('/')
    const toast = page.raw.locator('[data-test="deployment-toast"]')
    await expect(
      toast.getByText('Waiting for CI', { exact: true })
    ).toBeVisible()
    await expect(toast).toContainText('Waiting for a matching local result')
    await sails.models.deploymentjob
      .updateOne({ id: job.id })
      .set({ stage: 'ci_test' })
    await expect(toast.getByText('Running CI', { exact: true })).toBeVisible()
    await expect(
      toast.getByText('Running tests', { exact: true })
    ).toBeVisible()
    const output = path.resolve('.tmp/screenshots/ci-automatic')
    fs.mkdirSync(output, { recursive: true })
    await toast.screenshot({
      path: path.join(output, 'running-ci-toast.png'),
      animations: 'disabled'
    })
    await sails.models.deploymentjob
      .updateOne({ id: job.id })
      .set({ stage: 'image_build' })
    await expect(toast.getByText('Building', { exact: true })).toBeVisible()
    await expect(toast.getByText('Running CI', { exact: true })).toHaveCount(0)
    await sails.models.deployment
      .updateOne({ id: deployment.id })
      .set({ status: 'cancelled' })
    await expect(toast.getByText('Cancelled', { exact: true })).toBeVisible()
    expect(page).toHaveNoJavascriptErrors()
  }
)
