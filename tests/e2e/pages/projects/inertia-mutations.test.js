const { test } = require('sounding')
test(
  'Inertia page saves retain navigation and service rename handles keyboard cancel and duplicate blur',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'inertia-browser' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'Original database',
      status: 'stopped'
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    const base = '/projects/inertia-browser/environments/production'
    await page.goto(`${base}/apps/web/settings`)
    let writes = 0
    page.raw.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        request.headers().precognition !== 'true'
      ) {
        expect(request.headers()['x-inertia']).toBe('true')
        writes++
      }
    })
    await page.raw.locator('#appName').fill('Page saved app')
    await page.raw.locator('#appName').press('Tab')
    await page.raw
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await page.raw.getByText('App settings saved', { exact: true }).waitFor()
    expect(new URL(page.raw.url()).pathname).toBe(`${base}/apps/web/settings`)
    expect(
      (await sails.models.app.findOne({ id: world.current.apps.web.id })).name
    ).toBe('Page saved app')
    await page.goto(`${base}/services/${service.id}`)
    await page.raw
      .getByRole('button', { name: 'Rename service', exact: true })
      .focus()
    await page.raw.keyboard.press('Enter')
    const name = page.raw.locator('.name-editor input')
    await expect(name).toBeFocused()
    await name.fill('Cancelled name')
    await name.press('Escape')
    await expect(
      page.raw.getByRole('button', { name: 'Rename service', exact: true })
    ).toHaveText('Original database')
    const before = writes
    await page.raw
      .getByRole('button', { name: 'Rename service', exact: true })
      .press('Space')
    await name.fill('Saved database')
    await name.press('Enter')
    await expect(
      page.raw.getByRole('button', { name: 'Rename service', exact: true })
    ).toHaveText('Saved database')
    expect(writes - before).toBe(1)
    expect((await sails.models.service.findOne({ id: service.id })).name).toBe(
      'Saved database'
    )
    for (const suffix of ['/apps/web', '']) {
      await page.goto(`${base}${suffix}?env=1`)
      await page.raw
        .getByPlaceholder('KEY', { exact: true })
        .fill('PRIVATE_FIXTURE')
      await page.raw
        .getByPlaceholder('value', { exact: true })
        .fill('fixture-private-value')
      await page.raw.getByPlaceholder('value', { exact: true }).press('Enter')
      await expect(
        page.raw.getByPlaceholder('KEY', { exact: true })
      ).toHaveValue('')
      expect(new URL(page.raw.url()).pathname).toBe(`${base}${suffix}`)
      const model = suffix ? 'app' : 'environment'
      const id = suffix
        ? world.current.apps.web.id
        : world.current.environments.production.id
      const persisted = await sails.models[model].findOne({ id }).decrypt()
      expect(
        (persisted.secureEnvVars || persisted.envVars).PRIVATE_FIXTURE
      ).toBe('fixture-private-value')
      expect(persisted.envVarMetadata.PRIVATE_FIXTURE.kind).toBe('secret')
    }
    expect(page).toHaveNoJavascriptErrors()
  }
)
