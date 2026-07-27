const { test } = require('sounding')

const sqlExample = [
  'SELECT id, email',
  'FROM users',
  'WHERE active = true',
  'ORDER BY created_at DESC;'
].join('\n')

const javascriptExample = [
  'const creators = await Creator.find({',
  '  where: { isActive: true },',
  '  limit: 20',
  '})',
  'return creators'
].join('\n')

const envExample = [
  '# Runtime configuration',
  'NODE_ENV=production',
  'SESSION_SECRET=replace-me',
  'LOG_LEVEL=info'
].join('\n')

async function verifyRealEditor({ page, expect, selector, value, ariaLabel }) {
  await page.wait(selector)
  await page.fill(selector, value)

  const structure = await page.script((target) => {
    const editor = document.querySelector(target)
    const host = editor.closest('[data-code-editor]')

    return {
      tagName: editor.tagName,
      contentEditable: editor.getAttribute('contenteditable'),
      role: editor.getAttribute('role'),
      ariaLabel: editor.getAttribute('aria-label'),
      textareaCount: host.querySelectorAll('textarea').length,
      overlayCount: host.querySelectorAll('pre').length,
      wrapped: editor.classList.contains('cm-lineWrapping')
    }
  }, selector.replace('@', '[data-test="').concat('"]'))

  expect(structure.tagName).toBe('DIV')
  expect(structure.contentEditable).toBe('true')
  expect(structure.role).toBe('textbox')
  expect(structure.ariaLabel).toBe(ariaLabel)
  expect(structure.textareaCount).toBe(0)
  expect(structure.overlayCount).toBe(0)
  expect(structure.wrapped).toBe(true)

  await page.key('ControlOrMeta+a')
  await page.key('ControlOrMeta+c')

  expect(await page.script(() => window.getSelection().toString())).toBe(value)
  expect(await page.script(() => navigator.clipboard.readText())).toBe(value)

  await page.key('ArrowLeft')
  await page.key('Shift+ArrowRight')
  expect(await page.script(() => window.getSelection().toString())).toBe(
    value[0]
  )
  await page.key('ArrowRight')
}

async function screenshotAroundEditor(page, selector, path) {
  const editor = page.raw.locator(
    selector.replace('@', '[data-test="').concat('"]')
  )
  await editor.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
  )
  await page.wait(100)
  await page.screenshot(path)
}

async function navigateAfterUpdateCheck(page, target) {
  const updateCheckFinished = page.raw.waitForResponse(
    '**/api/v1/system/check-update'
  )
  await page.goto(target)
  await updateCheckFinished
}

test(
  'Slipway code editors provide native selection and exact copy behavior everywhere',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'real-code-editors',
          name: 'Real Code Editors'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug
    const appSlug = current.apps.web.slug

    await sails.models.environment
      .updateOne({ id: current.environments.production.id })
      .set({
        envVars: {
          NODE_ENV: 'production',
          SESSION_SECRET: 'environment-secret',
          LOG_LEVEL: 'info'
        }
      })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: null,
      envVars: {
        SAILS_ENV: 'production',
        APP_FEATURES: 'content,quest',
        CACHE_TTL: '300'
      }
    })
    const database = await world.create('service').with({
      name: 'primary-db',
      type: 'postgresql',
      version: '17',
      status: 'running',
      environment: current.environments.production.id,
      internalHost: 'primary-db',
      internalPort: 5432,
      database: 'app',
      username: 'slipway',
      password: 'secret'
    })
    await sails.helpers.setting.set.with({
      key: 'globalEnvVars',
      value: JSON.stringify({
        R2_ACCESS_KEY: 'global-access-key',
        R2_BUCKET: 'slipway-backups',
        SUPPORT_EMAIL: 'ops@example.com'
      })
    })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    await page.raw.route('**/dock/tables?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tables: [] })
      })
    })
    await page.raw.route('**/dock/sql?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          columns: [],
          rows: [],
          rowCount: 0,
          duration: 1
        })
      })
    })

    const loginUpdateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await loginUpdateCheckFinished
    await page.raw
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.resize(1440, 900)
    await page.inLightMode()

    const dockPath = `/projects/${projectSlug}/environments/${environmentSlug}/dock/${database.id}`
    await navigateAfterUpdateCheck(page, dockPath)
    await verifyRealEditor({
      page,
      expect,
      selector: '@dock-query-editor',
      value: sqlExample,
      ariaLabel: 'Database query'
    })
    await page.screenshot('.tmp/issue-212-dock-query-light.png')

    const execution = page.raw.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().includes('/dock/sql')
    )
    await page.key('ControlOrMeta+Enter')
    expect((await execution).postDataJSON().query).toBe(sqlExample)

    await page.inDarkMode()
    await page.wait(350)
    await page.screenshot('.tmp/issue-212-dock-query-dark.png')

    await navigateAfterUpdateCheck(page, `${dockPath}?import=1`)
    await verifyRealEditor({
      page,
      expect,
      selector: '@dock-import-editor',
      value: `${sqlExample}\n\nINSERT INTO audit_logs (event) VALUES ('ready');`,
      ariaLabel: 'SQL import'
    })
    await page.screenshot('.tmp/issue-212-dock-import-dark.png')

    await page.inLightMode()
    await navigateAfterUpdateCheck(page, '/bosun?tab=console')
    await verifyRealEditor({
      page,
      expect,
      selector: '@bosun-sql-editor',
      value: sqlExample,
      ariaLabel: 'Bosun SQL query'
    })
    await page.screenshot('.tmp/issue-212-bosun-sql-light.png')

    await page.raw.getByRole('button', { name: 'Helm', exact: true }).click()
    await page.inDarkMode()
    await page.wait(350)
    await verifyRealEditor({
      page,
      expect,
      selector: '@bosun-helm-editor',
      value: javascriptExample,
      ariaLabel: 'Bosun Helm code'
    })
    await page.screenshot('.tmp/issue-212-bosun-helm-dark.png')

    await page.inLightMode()
    await navigateAfterUpdateCheck(
      page,
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )
    await verifyRealEditor({
      page,
      expect,
      selector: '@helm-editor',
      value: javascriptExample,
      ariaLabel: 'Helm JavaScript'
    })
    await page.screenshot('.tmp/issue-212-project-helm-light.png')
    await page.inDarkMode()
    await page.wait(350)
    await page.screenshot('.tmp/issue-212-project-helm-dark.png')

    await page.inLightMode()
    await navigateAfterUpdateCheck(
      page,
      `/projects/${projectSlug}/environments/${environmentSlug}/apps/${appSlug}?bulk=1`
    )
    await verifyRealEditor({
      page,
      expect,
      selector: '@app-env-editor',
      value: envExample,
      ariaLabel: 'Application environment variables'
    })
    await screenshotAroundEditor(
      page,
      '@app-env-editor',
      '.tmp/issue-212-app-env-light.png'
    )

    await page.inDarkMode()
    await navigateAfterUpdateCheck(
      page,
      `/projects/${projectSlug}/environments/${environmentSlug}?bulk=1`
    )
    await verifyRealEditor({
      page,
      expect,
      selector: '@environment-env-editor',
      value: envExample,
      ariaLabel: 'Environment variables'
    })
    await screenshotAroundEditor(
      page,
      '@environment-env-editor',
      '.tmp/issue-212-environment-env-dark.png'
    )

    await page.inLightMode()
    await navigateAfterUpdateCheck(page, '/settings/global-env?bulk=1')
    await verifyRealEditor({
      page,
      expect,
      selector: '@global-env-editor',
      value: envExample,
      ariaLabel: 'Global environment variables'
    })
    await screenshotAroundEditor(
      page,
      '@global-env-editor',
      '.tmp/issue-212-global-env-light.png'
    )
    await page.inDarkMode()
    await page.wait(350)
    await screenshotAroundEditor(
      page,
      '@global-env-editor',
      '.tmp/issue-212-global-env-dark.png'
    )

    expect(page).toHaveNoSmoke()
  }
)
