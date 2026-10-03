const { test } = require('sounding')
const { readFile } = require('node:fs/promises')

function helmWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: {
        slug,
        name: 'Helm Layout'
      }
    }
  }
}

const HELM_COMPLETION_METADATA = {
  available: true,
  version: 1,
  models: [
    {
      identity: 'creator',
      globalId: 'Creator',
      attributes: [
        { name: 'email', type: 'string', association: null },
        { name: 'firstName', type: 'string', association: null },
        {
          name: 'invoices',
          type: 'collection:invoice',
          association: 'collection'
        }
      ]
    },
    {
      identity: 'invoice',
      globalId: 'Invoice',
      attributes: [
        { name: 'amount', type: 'number', association: null },
        { name: 'status', type: 'string', association: null }
      ]
    }
  ],
  helpers: [
    { path: 'mail.send' },
    { path: 'mail.sendTemplate' },
    { path: 'passwords.hashPassword' }
  ],
  config: [
    { path: 'custom', type: 'object' },
    { path: 'custom.appName', type: 'string' },
    { path: 'custom.baseUrl', type: 'string' },
    { path: 'models', type: 'object' },
    { path: 'models.migrate', type: 'string' }
  ]
}

function oversizedOutput() {
  return JSON.stringify(
    Array.from({ length: 180 }, (_, index) => ({
      id: index + 1,
      name: `creator-${index + 1}`,
      value: 'x'.repeat(160)
    })),
    null,
    2
  )
}

async function openHelmWithMockedExecution({ sails, world, login, page }) {
  const current = world.current
  const projectSlug = current.projects.deploymentTarget.slug
  const environmentSlug = current.environments.production.slug
  let executionCount = 0

  await sails.models.app.updateOne({ id: current.apps.web.id }).set({
    status: 'running',
    containerName: 'sounding-helm-app'
  })

  await login.withPassword('genesisUser', page, {
    password: current.auth.genesisUserPassword
  })
  await page.wait('text=Helm Layout')

  await page.raw.route(
    `**/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`,
    async (route) => {
      executionCount += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          executionCount === 1
            ? {
                success: true,
                value: JSON.parse(oversizedOutput()),
                logs: [],
                output: oversizedOutput(),
                error: null,
                durationMs: 14,
                truncated: false
              }
            : {
                success: true,
                value: { ready: true },
                logs: [],
                output: JSON.stringify({ ready: true }, null, 2),
                error: null,
                durationMs: 3,
                truncated: false
              }
        )
      })
    }
  )

  await page.goto(
    `/projects/${projectSlug}/environments/${environmentSlug}/helm`
  )
  await page.fill('@helm-editor', 'await Creator.find()')
  await page.click('@helm-run')
  await page.wait('@helm-output')
}

async function measureHelm(page) {
  return page.script(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect()
      return {
        height: box.height,
        width: box.width,
        left: box.left,
        top: box.top
      }
    }
    const outputScroll = document.querySelector(
      '[data-test="helm-output-scroll"]'
    )

    return {
      viewportHeight: window.innerHeight,
      page: rect('[data-test="helm-page"]'),
      workspace: rect('[data-test="helm-workspace"]'),
      editor: rect('[data-test="helm-editor-panel"]'),
      output: rect('[data-test="helm-output-panel"]'),
      outputClientHeight: outputScroll.clientHeight,
      outputScrollHeight: outputScroll.scrollHeight
    }
  })
}

async function proveOutputScrollsAndEditorStillRuns({ page, expect }) {
  const outputScroll = page.raw.locator('[data-test="helm-output-scroll"]')
  await outputScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  expect(
    (await outputScroll.evaluate((element) => element.scrollTop)) > 0
  ).toBe(true)

  await page.fill('@helm-editor', 'return { ready: true }')
  expect(
    await page.script(
      () =>
        document.activeElement?.matches('[data-test="helm-editor"]') === true
    )
  ).toBe(true)
  await page.click('@helm-run')
  await page.raw
    .locator('[data-test="helm-output"]')
    .filter({ hasText: 'ready' })
    .waitFor()
  expect(
    (
      await page.raw.locator('[data-test="helm-output"]').textContent()
    ).includes('ready')
  ).toBe(true)
  expect(
    (
      await page.raw.locator('[data-test="helm-output"]').textContent()
    ).includes('true')
  ).toBe(true)
  expect(page).toHaveNoSmoke()
}

async function selectFromSecondLine(page, { toDocumentEnd = true } = {}) {
  await page.key('ControlOrMeta+Home')
  await page.key('ArrowDown')
  await page.key('Home')
  if (!toDocumentEnd) {
    // CodeMirror's first Home press stops after indentation. Pressing it again
    // selects from the true start of a whitespace-only line.
    await page.key('Home')
  }
  await page.raw.keyboard.down('Shift')
  await page.key(toDocumentEnd ? 'ControlOrMeta+End' : 'End')
  await page.raw.keyboard.up('Shift')
}

test(
  'project Helm keeps named scratchpads durable without storing returned values',
  {
    browser: true,
    world: helmWorld('helm-named-scratchpads')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug
    const endpoint = `/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`
    const returnedValue = 'server-only-result'

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'sounding-helm-scratchpads-app'
    })
    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route(`**${endpoint}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          value: [{ id: 1, name: returnedValue }],
          logs: [`loaded ${returnedValue}`],
          output: JSON.stringify([{ id: 1, name: returnedValue }], null, 2),
          error: null,
          durationMs: 5,
          truncated: false
        })
      })
    })

    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )

    const tabs = page.raw.locator('[data-test="helm-scratchpads"] [role="tab"]')
    expect(await tabs.count()).toBe(1)
    expect((await tabs.first().textContent()).includes('Production')).toBe(
      false
    )

    await page.fill('@helm-editor', 'await Creator.find()')
    expect((await tabs.first().textContent()).includes('Modified')).toBe(true)

    await page.click('@helm-scratchpad-create')
    expect(await tabs.count()).toBe(2)
    await page.fill('@helm-editor', 'await Creator.find().limit(1)')

    await tabs.nth(1).click()
    const rename = page.raw.getByRole('textbox', { name: 'Scratchpad name' })
    await expect(rename).toBeFocused()
    expect(
      await rename.evaluate((el) => getComputedStyle(el).borderBottomStyle)
    ).toBe('dashed')
    await rename.fill('Creator audit')
    await page.screenshot('.tmp/issue-590-helm-rename-light.png')
    await page.click('@helm-editor')
    await expect(rename).toHaveCount(0)
    await expect(
      page.raw.getByText('Scratchpad renamed', { exact: true })
    ).toBeVisible()
    await expect(
      page.raw.getByText('Scratchpad renamed', { exact: true })
    ).toHaveCount(0)
    await tabs.nth(1).click()
    await rename.fill('Discard this name')
    await rename.press('Escape')
    await expect(tabs.nth(1)).toBeFocused()
    await expect(
      page.raw.getByText('Scratchpad renamed', { exact: true })
    ).toHaveCount(0)
    await tabs.nth(1).click()
    await rename.fill('Creator audit')
    await rename.press('Enter')
    await expect(tabs.nth(1)).toBeFocused()
    expect((await tabs.nth(1).textContent()).includes('Creator audit')).toBe(
      true
    )

    // An unchanged name is quiet; keyboard focus has one inset neutral indicator.
    await expect(
      page.raw.getByText('Scratchpad renamed', { exact: true })
    ).toHaveCount(0)
    const focusStyle = await tabs.nth(1).evaluate((element) => {
      const style = getComputedStyle(element)
      return { outline: style.outlineStyle, shadow: style.boxShadow }
    })
    expect(focusStyle.outline).toBe('none')
    expect(focusStyle.shadow).toContain('inset')
    await page.screenshot('.tmp/issue-655-rename-light.png')
    await page.inDarkMode()
    await page.resize(600, 844)
    await tabs.nth(1).click()
    await rename.fill(
      'Creator reconciliation audit with a long scratchpad title'
    )
    await rename.press('Enter')
    await expect(tabs.nth(1)).toBeFocused()
    await expect(
      page.raw.getByText('Scratchpad renamed', { exact: true })
    ).toBeVisible()
    await page.screenshot('.tmp/issue-655-rename-dark-narrow.png')
    await expect(
      page.raw.getByText('Scratchpad renamed', { exact: true })
    ).toHaveCount(0)

    // A rejected write leaves the old persisted title intact and gives a useful error.
    await page.raw.evaluate(() => {
      window.originalStorageSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === 'slipway:helm-scratchpads')
          throw new DOMException('Storage full', 'QuotaExceededError')
        return window.originalStorageSetItem.call(this, key, value)
      }
    })
    await tabs.nth(1).click()
    await rename.fill('This name cannot be saved')
    await rename.press('Enter')
    await expect(
      page.raw.getByText(
        'Could not save the name. Check browser storage permissions and try again.'
      )
    ).toBeVisible()
    await expect(tabs.nth(1)).toContainText('Creator reconciliation audit')
    await expect(
      page.raw.getByText('Scratchpad renamed', { exact: true })
    ).toHaveCount(0)
    await page.raw.evaluate(() => {
      Storage.prototype.setItem = window.originalStorageSetItem
    })
    await page.resize(1440, 900)
    await page.inLightMode()
    await tabs.nth(1).click()
    await rename.fill('Creator audit')
    await rename.press('Enter')
    await expect(
      page.raw.getByText('Scratchpad renamed', { exact: true })
    ).toBeVisible()

    await page.click('@helm-run')
    await page.wait('@helm-result-table')
    await page.click('@helm-view-raw')
    expect(
      await page.raw
        .locator('[data-test="helm-view-raw"]')
        .getAttribute('aria-pressed')
    ).toBe('true')

    await tabs.first().click()
    expect(
      (
        await page.raw.locator('[data-test="helm-editor"]').textContent()
      ).includes('await Creator.find()')
    ).toBe(true)
    expect(page).toSee('Run JavaScript to see results')

    await tabs.first().focus()
    await page.key('ArrowRight')
    expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true')
    expect(
      (
        await page.raw.locator('[data-test="helm-output"]').textContent()
      ).includes(returnedValue)
    ).toBe(true)

    await page.click('@helm-scratchpad-actions-trigger')
    await page.click('@helm-scratchpad-actions-save')
    await page.wait('@helm-snippet-dialog')
    expect(
      (
        await page.raw
          .locator('[data-test="helm-snippet-source"]')
          .textContent()
      ).includes('await Creator.find().limit(1)')
    ).toBe(true)
    await page.raw
      .locator('[data-test="helm-snippet-dialog"]')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()

    await page.click('@helm-scratchpad-actions-trigger')
    await page.click('@helm-scratchpad-actions-duplicate')
    expect(await tabs.count()).toBe(3)
    await page.click('@helm-scratchpad-actions-trigger')
    await page.click('@helm-scratchpad-actions-move-left')
    expect(
      (await tabs.nth(1).textContent()).includes('Copy of Creator audit')
    ).toBe(true)

    await page.click('@helm-scratchpad-actions-trigger')
    await page.click('@helm-scratchpad-actions-close')
    const closeScratchpadDialog = page.raw.locator(
      '[data-test="confirm-modal"][open]'
    )
    await closeScratchpadDialog.waitFor()
    await closeScratchpadDialog
      .getByRole('button', { name: 'Delete scratchpad', exact: true })
      .click()
    expect(await tabs.count()).toBe(2)

    const storedBeforeReload = await page.raw.evaluate(() =>
      window.localStorage.getItem('slipway:helm-scratchpads')
    )
    expect(storedBeforeReload.includes(returnedValue)).toBe(false)

    await page.reload()
    expect(await tabs.count()).toBe(2)
    await expect(tabs.nth(1)).toContainText('Creator audit')
    expect(page).toSee('Run JavaScript to see results')
    expect(
      (
        await page.raw.locator('[data-test="helm-editor"]').textContent()
      ).includes('await Creator.find().limit(1)')
    ).toBe(true)

    await page.click('@helm-run')
    await page.wait('@helm-result-raw')
    expect(
      await page.raw
        .locator('[data-test="helm-view-raw"]')
        .getAttribute('aria-pressed')
    ).toBe('true')
    await page.screenshot('.tmp/issue-276-helm-scratchpads-light.png')

    await page.raw.evaluate(() => {
      const key = 'slipway:helm-scratchpads'
      const state = JSON.parse(window.localStorage.getItem(key))
      const sourceTab = state.tabs[0]
      state.tabs.push({
        ...sourceTab,
        id: 'remote-production-tab',
        name: 'Billing repair',
        source: 'await Invoice.find()',
        baselineSource: 'await Invoice.find()',
        target: {
          key: 'billing-project:billing-production:billing-app',
          project: {
            id: 'billing-project',
            name: 'Billing',
            slug: 'billing'
          },
          environment: {
            id: 'billing-production',
            name: 'Production',
            slug: 'production',
            isProduction: true
          },
          app: {
            id: 'billing-app',
            name: 'billing.app',
            slug: 'billing-app'
          },
          href: '/projects/billing/environments/production/helm?appSlug=billing-app'
        }
      })
      state.activeByTarget['billing-project:billing-production:billing-app'] =
        'remote-production-tab'
      window.localStorage.setItem(key, JSON.stringify(state))
    })
    await page.inDarkMode()
    await page.reload()
    await expect(
      page.raw.getByRole('tab', { name: /Billing repair/ })
    ).toHaveCount(0)
    const stored = await page.raw.evaluate(() =>
      JSON.parse(window.localStorage.getItem('slipway:helm-scratchpads'))
    )
    expect(stored.tabs.some((tab) => tab.id === 'remote-production-tab')).toBe(
      true
    )

    // Every tab has a direct delete button. Deleting the last one stays deleted.
    while (await tabs.count()) {
      await page.raw
        .locator('[data-test="helm-scratchpads"]')
        .getByRole('button', { name: /^Delete / })
        .first()
        .click()
      const confirmation = page.raw.getByRole('button', {
        name: 'Delete scratchpad',
        exact: true
      })
      if (await confirmation.isVisible()) await confirmation.click()
    }
    await expect(
      page.raw.getByText('No scratchpads for this app.')
    ).toBeVisible()
    await page.reload()
    await expect(tabs).toHaveCount(0)
    await expect(
      page.raw.getByText('No scratchpads for this app.')
    ).toBeVisible()
    await page.click('@helm-scratchpad-create')
    await expect(tabs).toHaveCount(1)
    expect(page).toHaveNoSmoke()
  }
)

test(
  'Helm keeps its editor visible while oversized output scrolls on desktop',
  { browser: true, world: helmWorld('helm-layout-desktop') },
  async ({ sails, world, login, page, expect }) => {
    await openHelmWithMockedExecution({ sails, world, login, page })

    const layout = await measureHelm(page)
    expect(layout.page.height <= layout.viewportHeight).toBe(true)
    expect(layout.editor.width > layout.workspace.width * 0.35).toBe(true)
    expect(layout.output.width > layout.workspace.width * 0.35).toBe(true)
    expect(layout.outputScrollHeight > layout.outputClientHeight).toBe(true)

    await proveOutputScrollsAndEditorStillRuns({ page, expect })
  }
)

test(
  'project Helm pins syntax and selected runtime failures to their source',
  {
    browser: true,
    world: helmWorld('helm-inline-diagnostics')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug
    const endpoint = `/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`
    const submitted = []
    let runtimeAttempts = 0

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'sounding-helm-error-app'
    })
    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route(`**${endpoint}`, async (route) => {
      const request = route.request().postDataJSON()
      submitted.push(request)

      let result
      if (request.code.includes('const broken =')) {
        result = failedHelmResult({
          name: 'SyntaxError',
          message: 'Unexpected end of input',
          line: 2,
          column: 1,
          frames: [
            '    at new Script (node:vm:117:7)',
            ...Array.from(
              { length: 35 },
              (_, index) =>
                `    at applicationFrame${index} (app.js:${index + 1}:7)`
            )
          ],
          durationMs: 2
        })
      } else if (request.code.includes('creator.publicId')) {
        runtimeAttempts += 1
        result =
          runtimeAttempts === 1
            ? failedHelmResult({
                name: 'TypeError',
                message: "Cannot read properties of null (reading 'publicId')",
                line: 3,
                column: 9,
                logs: ['checking creator'],
                frames: ['    at node:vm:134:12'],
                durationMs: 4
              })
            : {
                success: true,
                value: { recovered: true },
                logs: [],
                output: JSON.stringify({ recovered: true }, null, 2),
                error: null,
                durationMs: 3,
                truncated: false
              }
      } else {
        result = flatHelmResult()
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(result)
      })
    })

    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )
    await page.fill('@helm-editor', 'const broken =\n')
    await page.click('@helm-run')
    await page.wait('@helm-error')

    expect(
      await page.raw.locator('[data-test="helm-error-summary"]').textContent()
    ).toBe('SyntaxError: Unexpected end of input')
    expect(
      await page.raw.locator('[data-test="helm-error-location"]').textContent()
    ).toBe('Line 2, column 1')
    expect(await page.raw.locator('.cm-inline-diagnostic').textContent()).toBe(
      'SyntaxError: Unexpected end of input'
    )
    expect(await page.raw.locator('.cm-lintRange-error').textContent()).toBe(
      '='
    )
    expect(
      await page.raw
        .locator('[data-test="helm-error-stack"]')
        .getAttribute('open')
    ).toBe(null)
    expect(
      await page.raw
        .locator('[data-test="helm-error-stack-content"]')
        .isVisible()
    ).toBe(false)
    await page.screenshot('.tmp/issue-270-project-syntax-light.png')

    await page.raw.locator('[data-test="helm-error-stack"] summary').click()
    expect(
      await page.raw
        .locator('[data-test="helm-error-stack-content"]')
        .isVisible()
    ).toBe(true)
    expect(
      await page.raw
        .locator('[data-test="helm-error-stack-content"]')
        .textContent()
    ).toContain('node:vm:117:7')
    const stackFitsOneScroller = await page.script(() => {
      const stack = document.querySelector(
        '[data-test="helm-error-stack-content"]'
      )
      const output = document.querySelector('[data-test="helm-output-scroll"]')
      return {
        stackHasOwnScroll: stack.scrollHeight > stack.clientHeight,
        outputScrolls: output.scrollHeight > output.clientHeight
      }
    })
    expect(stackFitsOneScroller.stackHasOwnScroll).toBe(false)
    expect(stackFitsOneScroller.outputScrolls).toBe(true)
    await page.screenshot('.tmp/issue-622-helm-stack-top-light.png')
    await page.script(() => {
      const output = document.querySelector('[data-test="helm-output-scroll"]')
      output.scrollTop = output.scrollHeight
    })
    expect(
      await page.script(() => {
        const stack = document.querySelector(
          '[data-test="helm-error-stack-content"]'
        )
        const output = document.querySelector(
          '[data-test="helm-output-scroll"]'
        )
        return (
          stack.getBoundingClientRect().bottom <=
          output.getBoundingClientRect().bottom + 1
        )
      })
    ).toBe(true)
    await page.screenshot('.tmp/issue-622-helm-stack-end-light.png')

    const documentSource = [
      'const outsideSelection = true',
      'const creator = null',
      'creator.publicId'
    ].join('\n')
    const selectedSource = ['const creator = null', 'creator.publicId'].join(
      '\n'
    )
    await page.fill('@helm-editor', documentSource)
    expect(await page.raw.locator('.cm-lintRange-error').count()).toBe(0)
    expect(await page.raw.locator('.cm-inline-diagnostic').count()).toBe(0)
    await selectFromSecondLine(page)
    await page.inDarkMode()
    const runtimeFinished = page.raw.waitForResponse(`**${endpoint}`)
    await page.click('@helm-run')
    await runtimeFinished
    await expect(
      page.raw.locator('[data-test="helm-error-location"]')
    ).toHaveText('Line 3, column 9')

    expectHelmSubmission(expect, submitted[1], {
      code: selectedSource,
      sourceStartLine: 2,
      sourceStartColumn: 1
    })
    expect(await page.raw.locator('.cm-lintRange-error').textContent()).toBe(
      'publicId'
    )
    expect(
      await page.raw.locator('[data-test="helm-error-location"]').textContent()
    ).toBe('Line 3, column 9')
    expect(
      await page.raw.locator('[data-test="helm-logs"]').textContent()
    ).toContain('checking creator')
    await page.screenshot('.tmp/issue-270-project-selection-runtime-dark.png')

    await page.key('ControlOrMeta+Enter')
    await page.wait('@helm-output')
    expectHelmSubmission(expect, submitted[2], {
      code: selectedSource,
      sourceStartLine: 2,
      sourceStartColumn: 1
    })
    expect(await page.raw.locator('.cm-lintRange-error').count()).toBe(0)
    expect(await page.raw.locator('.cm-inline-diagnostic').count()).toBe(0)
    expect(
      await page.raw.locator('[data-test="helm-output"]').textContent()
    ).toContain('recovered')
    expect(page).toHaveNoSmoke()
  }
)

test(
  'Helm presents structured values as minimal table, tree, and raw views',
  {
    browser: true,
    world: helmWorld('helm-structured-results')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug
    const endpoint = `/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'sounding-helm-structured-app'
    })
    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.raw.route(`**${endpoint}`, async (route) => {
      const { code } = route.request().postDataJSON()
      const result = code.includes('nested records')
        ? { ...nestedHelmResult(), value: [nestedHelmResult().value.course] }
        : code.includes('nested')
        ? nestedHelmResult()
        : {
            ...flatHelmResult(),
            logs: []
          }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(result)
      })
    })

    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )
    await page.fill('@helm-editor', 'await Creator.find().limit(3)')
    await page.click('@helm-run')
    await page.wait('@helm-result-table')

    await expect(
      page.raw.locator('[data-test="helm-result-table"]')
    ).toHaveAttribute('data-slot', 'table')

    expect(
      await page.raw.locator('[data-test="helm-result-table"] tbody tr').count()
    ).toBe(3)
    expect(
      await page.raw.locator('[data-test="helm-result-status"]').textContent()
    ).toContain('3 rows')
    expect(
      await page.raw
        .locator('[data-test="helm-view-table"]')
        .getAttribute('aria-pressed')
    ).toBe('true')
    expect(
      await page.raw
        .locator('[data-test="helm-view-table"]')
        .getAttribute('aria-label')
    ).toBe('Table view')
    expect(await page.raw.locator('[data-test="helm-logs"]').count()).toBe(0)
    await page.screenshot('.tmp/issue-269-project-table-light.png')
    await page.hover('@helm-view-table')
    await page.wait(200)
    expect(page).toSee('Table view')
    await page.screenshot('.tmp/issue-269-project-view-tooltip-light.png')
    await page.hover('@helm-editor')

    await page.click('@helm-result-actions-trigger')
    await page.screenshot('.tmp/issue-269-project-actions-light.png')
    await page.click('@helm-result-actions-copy-json')
    expect(await page.script(() => navigator.clipboard.readText())).toBe(
      JSON.stringify(flatHelmResult().value, null, 2)
    )
    await page.raw
      .getByText('Copied JSON to clipboard', { exact: true })
      .locator('..')
      .getByRole('button')
      .click()

    await page.click('@helm-result-actions-trigger')
    const downloadStarted = page.raw.waitForEvent('download')
    await page.click('@helm-result-actions-export-csv')
    const download = await downloadStarted
    expect(download.suggestedFilename()).toBe('helm-result.csv')
    const csv = await readFile(await download.path(), 'utf8')
    expect(csv.replace(/^\uFEFF/, '')).toContain("3,Grace Hopper,false,,,'=2+2")
    await page.raw
      .getByText('Exported helm-result.csv', { exact: true })
      .locator('..')
      .getByRole('button')
      .click()
    await page.wait(100)

    await page.inDarkMode()
    await page.click('@helm-editor')
    await page.key('ControlOrMeta+a')
    await page.raw.keyboard.type(
      "console.log('Loaded the course and its chapters.')\n// Return nested course data\nawait Course.findOne().populate('chapters')"
    )
    await page.click('@helm-run')
    await page.wait('@helm-result-tree')

    const tree = page.raw.locator('[data-test="helm-result-tree"]')
    await expect(
      tree.getByText('Building production Sails applications', { exact: true })
    ).toBeVisible()
    await tree.locator('summary').filter({ hasText: 'chapters' }).click()
    await tree.locator('summary').filter({ hasText: '0' }).click()
    expect(
      await page.raw.locator('[data-test="helm-result-status"]').textContent()
    ).toContain('Truncated')
    await page.screenshot('.tmp/issue-269-project-tree-dark.png')

    await page.click('@helm-view-raw')
    await page.raw.locator('[data-test="helm-logs"] summary').click()
    expect(
      (await page.raw
        .locator('[data-test="helm-logs"]')
        .getAttribute('open')) === null
    ).toBe(false)
    const consoleBox = await page.raw
      .locator('[data-test="helm-logs"]')
      .boundingBox()
    const statusBox = await page.raw
      .locator('[data-test="helm-result-status"]')
      .boundingBox()
    expect(consoleBox.y < statusBox.y).toBe(true)
    expect(consoleBox.height < 200).toBe(true)
    expect(await page.raw.locator('[data-helm-xss]').count()).toBe(0)
    expect(
      await page.raw.locator('[data-test="helm-result-raw"]').textContent()
    ).toContain('<img data-helm-xss')
    await page.screenshot('.tmp/issue-269-project-raw-console-dark.png')

    await page.click('@helm-view-tree')
    await page.fill('@helm-editor', '// nested records\nawait Course.find()')
    await page.click('@helm-run')
    await page.wait('@helm-result-tree')
    await expect(
      tree.getByText('Building production Sails applications', { exact: true })
    ).toBeVisible()
    const record = tree.locator(':scope > li > details').first()
    await expect(record).toHaveAttribute('open', '')
    const chapters = record
      .locator('details')
      .filter({
        has: page.raw.locator(':scope > summary', { hasText: 'chapters' })
      })
      .first()
    expect(await chapters.getAttribute('open')).toBe(null)
    await page.screenshot('.tmp/issue-590-helm-records-dark.png')
    await record.locator(':scope > summary').click()
    await expect(
      tree.getByText('Building production Sails applications', { exact: true })
    ).not.toBeVisible()
    await record.locator(':scope > summary').click()
    await expect(
      tree.getByText('Building production Sails applications', { exact: true })
    ).toBeVisible()

    expect(page).toHaveNoSmoke()
  }
)

function inspectedHelmResult({ inspectionLine, query }) {
  const creators = [
    {
      firstName: 'Ada',
      lastName: 'Lovelace',
      subscriptionStatus: 'active'
    }
  ]

  return {
    success: true,
    value: creators,
    logs: [],
    output: JSON.stringify(creators, null, 2),
    error: null,
    durationMs: 7,
    truncated: false,
    inspections: [
      {
        id: 0,
        line: inspectionLine,
        column: 73,
        values: [
          {
            value: creators,
            preview: JSON.stringify(creators),
            truncated: false
          }
        ],
        omittedCount: 0
      }
    ],
    queryTrace: {
      enabled: true,
      entries: [query],
      omittedCount: 0
    }
  }
}

test(
  'project Helm runs the selected source and keeps it ready to rerun',
  {
    browser: true,
    world: helmWorld('helm-selection-project')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug
    const endpoint = `/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`
    const submitted = []
    const selectedSource = [
      'await Creator.find()',
      '  .where({ isActive: true })',
      '  .limit(2)'
    ].join('\n')
    const documentSource = [
      'const outsideSelection = "must not run"',
      selectedSource
    ].join('\n')

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'sounding-helm-selection-app'
    })
    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route(`**${endpoint}`, async (route) => {
      submitted.push(route.request().postDataJSON())
      await new Promise((resolve) => setTimeout(resolve, 80))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          value: [{ id: 1 }],
          logs: [],
          output: JSON.stringify([{ id: 1 }], null, 2),
          error: null,
          durationMs: 6,
          truncated: false
        })
      })
    })

    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )
    await page.fill('@helm-editor', documentSource)
    await selectFromSecondLine(page)

    expect(await page.script(() => window.getSelection().toString())).toBe(
      selectedSource
    )
    expect(
      await page.raw.locator('[data-test="helm-run"]').textContent()
    ).toContain('Run selection')
    await page.screenshot('.tmp/issue-268-project-helm-selection-light.png')

    await page.click('@helm-run')
    await page.wait('.cm-executed-range')
    await page.wait('@helm-output')

    expectHelmSubmission(expect, submitted[0], {
      code: selectedSource,
      sourceStartLine: 2,
      sourceStartColumn: 1
    })
    expect(await page.script(() => window.getSelection().toString())).toBe(
      selectedSource
    )
    expect(
      await page.script(
        () =>
          document.activeElement?.matches('[data-test="helm-editor"]') === true
      )
    ).toBe(true)
    const rerun = page.raw.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().includes(endpoint)
    )
    await page.key('ControlOrMeta+Enter')
    const rerunSubmission = (await rerun).postDataJSON()
    expectHelmSubmission(expect, rerunSubmission, {
      code: selectedSource,
      sourceStartLine: 2,
      sourceStartColumn: 1
    })
    expect(rerunSubmission.executionId === submitted[0].executionId).toBe(false)
    await page.wait(750)
    expect(await page.raw.locator('.cm-executed-range').count()).toBe(0)

    const whitespaceDocument = [
      'const outsideSelection = true',
      '   ',
      'await Creator.find()'
    ].join('\n')
    await page.fill('@helm-editor', whitespaceDocument)
    await selectFromSecondLine(page, { toDocumentEnd: false })
    expect(await page.script(() => window.getSelection().toString())).toBe(
      '   '
    )
    expect(
      await page.raw.locator('[data-test="helm-run"]').textContent()
    ).toContain('Run selection')
    expect(await page.raw.locator('[data-test="helm-run"]').isDisabled()).toBe(
      true
    )
    const submissionCount = submitted.length
    await page.key('ControlOrMeta+Enter')
    await page.wait(100)
    expect(submitted.length).toBe(submissionCount)
    await page.resize(390, 844)
    expect(
      await page.raw.locator('[data-test="helm-run"] span').last().isVisible()
    ).toBe(true)
    expect(page).toHaveNoSmoke()
  }
)

function flatHelmResult() {
  return {
    success: true,
    value: [
      {
        id: 1,
        name: 'Ada Lovelace',
        active: true,
        lastSeenAt: {
          type: 'Date',
          value: '2026-07-29T09:24:00.000Z'
        },
        bio: null,
        formula: 'plain text'
      },
      {
        id: 2,
        name: 'Linus Torvalds',
        active: true,
        lastSeenAt: {
          type: 'Date',
          value: '2026-07-29T10:16:00.000Z'
        },
        bio: 'Maintains a carefully bounded result viewer.',
        formula: 'also plain'
      },
      {
        id: 3,
        name: 'Grace Hopper',
        active: false,
        lastSeenAt: null,
        bio: null,
        formula: '=2+2'
      }
    ],
    logs: ['Fetched creators from the primary datastore.'],
    output: 'Fetched creators from the primary datastore.',
    error: null,
    durationMs: 18,
    truncated: false
  }
}

function failedHelmResult({
  name = 'Error',
  message,
  line,
  column,
  logs = [],
  frames = [],
  durationMs = 3
}) {
  return {
    success: false,
    value: null,
    logs,
    output: logs.join('\n') || null,
    error: {
      name,
      message,
      stack: [
        `${name}: ${message}`,
        `    at helm-input.js:${line}:${column}`,
        ...frames
      ].join('\n'),
      filename: 'helm-input.js',
      line,
      column
    },
    durationMs,
    truncated: false
  }
}

function nestedHelmResult() {
  return {
    success: true,
    value: {
      course: {
        title: 'Building production Sails applications',
        published: true,
        chapters: [
          {
            title: 'A reliable deployment path',
            lessons: 6,
            description:
              '<img data-helm-xss src=x onerror="document.body.dataset.pwned=true">'
          },
          {
            title: 'Making failures boring',
            lessons: 4,
            description: 'Logs, health checks, cutover, and rollback.'
          }
        ],
        updatedAt: {
          type: 'Date',
          value: '2026-07-29T12:00:00.000Z'
        }
      },
      release: {
        version: '0.0.52',
        ready: true
      }
    },
    logs: ['Loaded the course and its chapters.'],
    output: 'Loaded the course and its chapters.',
    error: null,
    durationMs: 23,
    truncated: true
  }
}

test(
  'project Helm stops work, reports cancellation, and ignores a late older response',
  {
    browser: true,
    world: helmWorld('helm-cancellation-project')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug
    const endpoint = `/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`
    let executionCount = 0
    let releaseFirstExecution
    const firstExecutionCancelled = new Promise((resolve) => {
      releaseFirstExecution = resolve
    })

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'sounding-helm-cancellation-app'
    })
    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route(`**${endpoint}`, async (route) => {
      executionCount += 1

      if (executionCount === 1) {
        await firstExecutionCancelled
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            cancelledResult(['loaded creator 1'], {
              durationMs: 640,
              logsPartial: true
            })
          )
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: 'success',
          value: 'newer result',
          logs: [],
          output: 'newer result',
          outputBytes: 12,
          rowCount: null,
          error: null,
          durationMs: 18,
          truncated: false,
          logsPartial: false
        })
      })
    })
    await page.raw.route(
      '**/api/v1/helm/executions/*/cancel',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ cancelled: true })
        })
        setTimeout(releaseFirstExecution, 350)
      }
    )

    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )
    await page.fill(
      '@helm-editor',
      "console.log('loaded creator 1')\nawait new Promise(() => {})"
    )
    await page.click('@helm-run')
    await page.raw
      .locator('[data-test="helm-run"]')
      .filter({ hasText: 'Stop' })
      .waitFor()
    expect(
      await page.raw.locator('[data-test="helm-running-status"]').textContent()
    ).toContain('Running')
    await page.wait(250)
    await page.screenshot('.tmp/issue-271-project-running-stop-light.png')

    await page.click('@helm-run')
    await page.raw.locator('[data-test="helm-result-status"]').waitFor()
    expect(
      await page.raw.locator('[data-test="helm-result-status"]').textContent()
    ).toContain('Cancelled')
    await page.screenshot('.tmp/issue-271-project-cancelled-light.png')

    await page.fill('@helm-editor', "'newer result'")
    await page.click('@helm-run')
    await page.wait('@helm-output')
    expect(
      await page.raw.locator('[data-test="helm-output"]').textContent()
    ).toContain('newer result')
    await page.wait(500)
    expect(
      await page.raw.locator('[data-test="helm-output"]').textContent()
    ).toContain('newer result')
    expect(executionCount).toBe(2)
    expect(page).toHaveNoSmoke()
  }
)

test(
  'project Helm presents durable searchable history and inert reusable snippets',
  {
    browser: true,
    world: helmWorld('helm-durable-workspace')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const user = current.users.genesisUser
    const commonHistory = {
      status: 'success',
      target: app.slug,
      user: user.id,
      team: current.teams.genesisTeam.id,
      project: project.id,
      environment: environment.id,
      app: app.id
    }
    const pinned = await sails.models.helmhistoryentry
      .create({
        ...commonHistory,
        source: 'await Creator.find({ isActive: true }).limit(10)',
        durationMs: 18,
        executedAt: Date.now() - 60_000,
        pinned: true
      })
      .fetch()
    await sails.models.helmhistoryentry.create({
      ...commonHistory,
      source: 'await Course.find().populate("chapters")',
      durationMs: 42,
      executedAt: Date.now() - 5_000
    })
    await sails.models.helmsnippet.create({
      name: 'Active creators',
      source: 'await Creator.find({ isActive: true })',
      scope: 'personal',
      owner: user.id,
      team: current.teams.genesisTeam.id,
      project: project.id
    })
    await sails.models.helmsnippet.create({
      name: 'Published courses',
      source: 'await Course.find({ published: true })',
      scope: 'project',
      owner: user.id,
      team: current.teams.genesisTeam.id,
      project: project.id
    })
    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'running',
      containerName: 'sounding-helm-library-app'
    })

    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${project.slug}/environments/${environment.slug}/helm`
    )

    await page.click('@helm-history-toggle')
    await page.raw.locator('[data-test="helm-history-entry"]').first().waitFor()
    await expect(
      page.raw.locator('[data-test="helm-library-search"]')
    ).toHaveClass(/border-dashed/)
    await expect(
      page.raw.locator('[data-test="helm-library-search"]')
    ).not.toHaveClass(/rounded/)
    expect(
      await page.raw.locator('[data-test="helm-history-entry"]').count()
    ).toBe(2)
    expect(
      await page.raw
        .locator('[data-test="helm-library-history"]')
        .getAttribute('aria-label')
    ).toBe('History, 2 runs')
    await page.screenshot('.tmp/issue-273-helm-history-light.png')

    await page.raw
      .locator('[data-test="helm-library-history"]')
      .press('ArrowRight')
    expect(
      await page.raw
        .locator('[data-test="helm-library-snippets"]')
        .getAttribute('aria-selected')
    ).toBe('true')
    await page.raw
      .locator('[data-test="helm-library-snippets"]')
      .press('ArrowLeft')
    expect(
      await page.raw
        .locator('[data-test="helm-library-history"]')
        .getAttribute('aria-selected')
    ).toBe('true')
    expect(
      await page.raw
        .locator(`[data-test="helm-history-actions-${pinned.id}-trigger"]`)
        .count()
    ).toBe(1)

    await page.fill('@helm-library-search', 'Course.find')
    await page.wait(250)
    expect(
      await page.raw.locator('[data-test="helm-history-entry"]').count()
    ).toBe(1)
    expect(
      await page.raw.locator('[data-test="helm-history-entry"]').textContent()
    ).toContain('Course.find')
    await page.fill('@helm-library-search', '')
    await page.wait(250)

    await page.click('@helm-clear-history')
    const clearHistoryDialog = page.raw.locator(
      '[data-test="confirm-modal"][open]'
    )
    await clearHistoryDialog.waitFor()
    await clearHistoryDialog
      .getByRole('button', { name: 'Clear history', exact: true })
      .click()
    await clearHistoryDialog.waitFor({ state: 'detached' })
    await page.raw.locator('[data-test="helm-history-entry"]').first().waitFor()
    expect(
      await page.raw.locator('[data-test="helm-history-entry"]').count()
    ).toBe(1)
    expect(
      await page.raw.locator('[data-test="helm-history-entry"]').textContent()
    ).toContain('Creator.find')
    await page.raw
      .getByText('Recent history cleared', { exact: true })
      .locator('..')
      .getByRole('button')
      .click()
    await page.raw
      .getByText('Recent history cleared', { exact: true })
      .waitFor({ state: 'detached' })

    await page.inDarkMode()
    await page.click('@helm-library-snippets')
    await page.raw.locator('[data-test="helm-snippet-entry"]').first().waitFor()
    await page.wait(250)
    expect(
      await page.raw
        .locator('[data-test="helm-library-snippets"]')
        .getAttribute('aria-selected')
    ).toBe('true')
    expect(
      await page.raw
        .locator('[data-test="helm-library-snippets"]')
        .getAttribute('aria-label')
    ).toBe('Snippets, 2 snippets')
    expect(
      await page.raw.locator('[data-test="helm-snippet-entry"]').count()
    ).toBe(2)
    await page.screenshot('.tmp/issue-273-helm-snippets-dark.png')

    let executionRequests = 0
    page.raw.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request
          .url()
          .endsWith(
            `/api/v1/projects/${project.slug}/environments/${environment.slug}/execute`
          )
      ) {
        executionRequests += 1
      }
    })
    await page.raw
      .locator('[data-test="helm-snippet-entry"]')
      .filter({ hasText: 'Published courses' })
      .getByRole('button')
      .first()
      .click()
    await page.wait(100)
    expect(executionRequests).toBe(0)
    expect(
      await page.raw.locator('[data-test="helm-editor"]').textContent()
    ).toContain('Course.find({ published: true })')

    await page.click('@helm-new-snippet')
    await page.raw.locator('[data-test="helm-snippet-dialog"]').waitFor()
    await page.resize(390, 844)
    await page.wait(200)
    await page.screenshot('.tmp/issue-273-helm-snippet-dialog-mobile-dark.png')
    await page.fill('@helm-snippet-name', 'Published course check')
    await page.click('@helm-snippet-save')
    await expect(
      page.raw.getByText('Snippet saved', { exact: true })
    ).toBeVisible()
    await page.resize(1440, 900)
    await page.raw
      .locator('[data-test="helm-snippet-entry"]')
      .filter({ hasText: 'Published course check' })
      .waitFor()
    expect(
      await page.raw.locator('[data-test="helm-snippet-entry"]').count()
    ).toBe(3)
    expect(executionRequests).toBe(0)
    expect(page).toHaveNoSmoke()
  }
)

test(
  'project Helm completes models, attributes, and Waterline without stealing run shortcuts',
  {
    browser: true,
    world: helmWorld('helm-completion-project')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug
    let executionCount = 0

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'sounding-helm-completion-app'
    })

    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished

    await page.raw.route(
      `**/helm/completions?appSlug=${current.apps.web.slug}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(HELM_COMPLETION_METADATA)
        })
      }
    )
    await page.raw.route('**/execute', async (route) => {
      executionCount++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: 'success',
          value: [],
          logs: [],
          output: '[]',
          error: null,
          durationMs: 2,
          truncated: false,
          rowCount: 0,
          outputBytes: 2,
          logsPartial: false
        })
      })
    })

    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )

    await page.fill('@helm-editor', 'Cre')
    await page.raw.locator('.cm-tooltip-autocomplete').waitFor()
    expect(
      await page.raw.locator('.cm-tooltip-autocomplete').textContent()
    ).toContain('Creator')
    await page.screenshot('.tmp/issue-272-project-model-completion-light.png')

    await page.key('Escape')
    await page.fill('@helm-editor', 'Creator.find({ fir')
    await page.raw.locator('.cm-tooltip-autocomplete').waitFor()
    expect(
      await page.raw.locator('.cm-tooltip-autocomplete').textContent()
    ).toContain('firstName')
    await page.screenshot(
      '.tmp/issue-272-project-attribute-completion-light.png'
    )

    await page.fill('@helm-editor', 'Creator.fi')
    await page.raw.locator('.cm-tooltip-autocomplete').waitFor()
    await page.key('Enter')
    expect(
      await page.raw.locator('[data-test="helm-editor"]').textContent()
    ).toBe('Creator.find')
    expect(executionCount).toBe(0)

    await page.key('ControlOrMeta+Enter')
    await page.wait('@helm-output')
    expect(executionCount).toBe(1)
    expect(page).toHaveNoSmoke()
  }
)

function cancelledResult(logs, overrides = {}) {
  return {
    success: false,
    status: 'cancelled',
    value: null,
    logs,
    output: logs.join('\n') || null,
    outputBytes: Buffer.byteLength(logs.join('\n')),
    rowCount: null,
    error: {
      name: 'CancelledError',
      message: 'Helm execution was cancelled.',
      stack: null,
      filename: null,
      line: null,
      column: null,
      code: 'HELM_CANCELLED'
    },
    durationMs: 0,
    truncated: false,
    logsPartial: false,
    ...overrides
  }
}

function expectHelmSubmission(expect, actual, expected) {
  expect({
    code: actual.code,
    sourceStartLine: actual.sourceStartLine,
    sourceStartColumn: actual.sourceStartColumn
  }).toEqual(expected)
  expect(typeof actual.executionId).toBe('string')
  expect(actual.executionId.length).toBe(36)
}

const RESULT = {
  success: true,
  value: { updated: true },
  logs: [],
  output: '{\n  "updated": true\n}',
  error: null,
  durationMs: 18,
  truncated: false,
  status: 'success',
  outputBytes: 21,
  logsPartial: false
}

test(
  'Helm makes its production target obvious and requires a short-lived write arm',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'helm-production-guard',
          name: 'Helm Production Guard'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const originalExecute = sails.helpers.helm.executeInContainer
    const deployment = await sails.models.deployment
      .create({
        status: 'running',
        gitCommit: '274acbd91324beef',
        gitBranch: 'main',
        imageName: 'slipway/helm-production-guard:274acbd',
        environment: environment.id,
        app: app.id,
        triggeredBy: current.users.genesisUser.id
      })
      .fetch()

    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'running',
      containerName: 'helm-production-guard-web',
      currentDeployment: deployment.id
    })
    sails.helpers.helm.executeInContainer = async () => RESULT

    try {
      const updateCheckFinished = page.raw.waitForResponse(
        '**/api/v1/system/check-update'
      )
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await updateCheckFinished
      await page.raw
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.resize(1440, 900)
      await page.inLightMode()
      await page.goto(
        `/projects/${project.slug}/environments/${environment.slug}/helm`
      )

      expect(page).toSee('production')
      expect(page).toSee('web')
      expect(await page.raw.locator('[data-test="helm-target"]').count()).toBe(
        0
      )

      await page.fill(
        '@helm-editor',
        "await Creator.updateOne({ id: 1 }).set({ email: 'grace@example.com' })"
      )
      await page.click('@helm-run')
      await page.wait('@helm-write-guard')
      expect(page).toSee('Arm production writes?')
      expect(page).toSee('Update one record')
      expect(page).toSee('safety heuristic')
      await page.wait(200)
      await page.screenshot('.tmp/issue-274-write-warning-light.png')

      await page.inDarkMode()
      await page.click('@helm-arm-writes')
      await page.wait('@helm-writes-armed')
      await page.raw
        .locator('[data-test="helm-write-guard"]')
        .waitFor({ state: 'hidden' })
      await page.wait(150)
      expect(page).toSee('Run write')
      await page.screenshot('.tmp/issue-274-writes-armed-dark.png')

      await page.click('@helm-run')
      await page.wait('@helm-output')
      expect(page).toSee('updated')
      expect(
        await page.raw.locator('[data-test="helm-writes-armed"]').count()
      ).toBe(0)

      await page.click('@helm-result-actions-trigger')
      await page.click('@helm-result-actions-copy-diagnostics')
      const diagnostics = JSON.parse(
        await page.script(() => navigator.clipboard.readText())
      )
      expect(diagnostics.target.environment.isProduction).toBe(true)
      expect(diagnostics.target.app.slug).toBe(app.slug)
      expect(diagnostics.target.container).toBe('helm-production-guard-web')
      expect(diagnostics.execution.status).toBe('success')
      expect(JSON.stringify(diagnostics).includes('grace@example.com')).toBe(
        false
      )

      await page.inLightMode()
      await page.goto('/settings/audit-log?group=helm')
      await page.wait('@audit-events')
      expect(page).toSee('Ran Helm')
      expect(page).toSee('Armed Helm writes')
      await expect(page.raw.locator('[data-test="audit-search"]')).toHaveClass(
        /border-dashed/
      )
      await expect(
        page.raw.locator('[data-test="audit-search"]')
      ).not.toHaveClass(/rounded/)
      await page.screenshot('.tmp/issue-274-audit-light.png')

      await page.fill('@audit-search', 'armed')
      await page.wait(350)
      await page.wait('@audit-events')
      expect(page).toSee('Armed Helm writes')
      await page.inDarkMode()
      await page.screenshot('.tmp/issue-274-audit-search-dark.png')
      expect(page).toHaveNoSmoke()
    } finally {
      sails.helpers.helm.executeInContainer = originalExecute
    }
  }
)

const COMMAND_SCREENSHOTS = '.tmp/screenshots/issue-592-commands'
const COMMAND_FIXTURE_SOURCE = 'node -e "process.stdout.write(\'fixture\')"'
const COMMAND_FIXTURE_RESULT = {
  success: true,
  status: 'success',
  exitCode: 0,
  signal: null,
  exitStatusObserved: true,
  terminationConfirmed: true,
  terminationScope: 'foreground-process-group',
  durationMs: 24,
  outputBytes: 30,
  truncated: false
}

async function openCommandFixture(
  context,
  { production = false, worker = false } = {}
) {
  const { sails, world, login, page } = context
  const current = world.current
  const environment = current.environments.production
  await sails.models.environment
    .updateOne({ id: environment.id })
    .set({ isProduction: production })
  const app = worker
    ? await world.create('app').with({
        environment: environment.id,
        name: 'Fixture worker',
        slug: 'fixture-worker',
        isDefault: false,
        status: 'running',
        containerName: 'sounding-command-browser-worker'
      })
    : current.apps.web
  await sails.models.app.updateOne({ id: app.id }).set({
    status: 'running',
    containerName: 'sounding-command-browser-fixture'
  })
  // Completion metadata is unrelated to command execution and must never exec Docker.
  await page.raw.route('**/helm/completions*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(HELM_COMPLETION_METADATA)
    })
  )
  await login.withPassword('genesisUser', page, {
    password: current.auth.genesisUserPassword
  })
  // Password login resolves after clicking Submit, before its Inertia redirect.
  // Starting a second navigation earlier can abort session establishment.
  await page.raw.waitForURL((url) => url.pathname === '/')
  const path = `/projects/${current.projects.deploymentTarget.slug}/environments/${environment.slug}/helm?appSlug=${app.slug}`
  await page.goto(path)
  return { current, app, environment, path }
}

function commandFixtureRunner(sails, run) {
  const original = sails.helpers.helm.executeCommandInContainer
  const calls = []
  sails.helpers.helm.executeCommandInContainer = {
    async with(input) {
      calls.push(input)
      return run(input)
    }
  }
  return {
    calls,
    restore() {
      sails.helpers.helm.executeCommandInContainer = original
    }
  }
}

async function assertCommandFitsViewport(page, expect) {
  const layout = await page.script(() => {
    const console = document
      .querySelector('[data-test="helm-command-console"]')
      .getBoundingClientRect()
    const source = document
      .querySelector('#helm-command-input')
      .getBoundingClientRect()
    const output = document
      .querySelector('[aria-label="Command output"]')
      .getBoundingClientRect()
    return {
      console: {
        width: console.width,
        left: console.left,
        right: console.right,
        bottom: console.bottom
      },
      source: { width: source.width, top: source.top, bottom: source.bottom },
      output: { width: output.width, top: output.top, left: output.left },
      viewport: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      height: window.innerHeight
    }
  })
  expect(Math.abs(layout.console.width - layout.output.width) < 2).toBe(true)
  expect(Math.abs(layout.console.left - layout.output.left) < 2).toBe(true)
  expect(layout.source.width > layout.console.width * 0.5).toBe(true)
  expect(layout.output.top >= layout.source.bottom).toBe(true)
  expect(layout.console.right <= layout.viewport + 1).toBe(true)
  expect(layout.console.bottom <= layout.height + 1).toBe(true)
  expect(layout.overflow).toBe(false)
}

test(
  'project Helm command mode preserves JavaScript scratchpads and streams stdout and stderr before native completion',
  {
    browser: true,
    world: helmWorld('helm-command-browser-stream')
  },
  async (context) => {
    const { sails, page, expect } = context
    let finish
    let releaseHistory
    const runner = commandFixtureRunner(sails, async ({ onEvent }) => {
      onEvent({ type: 'started' })
      onEvent({ type: 'stdout', text: 'fixture stdout before completion\n' })
      onEvent({ type: 'stderr', text: 'fixture stderr before completion\n' })
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    try {
      const { app } = await openCommandFixture(context, { worker: true })
      await page.resize(1440, 900)
      await page.inLightMode()
      const scratchpad = 'return { fixtureScratchpad: true }'
      await page.fill('@helm-editor', scratchpad)
      const javascriptMode = page.raw.getByRole('button', {
        name: 'JavaScript mode',
        exact: true
      })
      const commandMode = page.raw.getByRole('button', {
        name: 'Command mode',
        exact: true
      })
      await expect(javascriptMode).toHaveAttribute('aria-pressed', 'true')
      await commandMode.focus()
      await page.key('Enter')
      await expect(commandMode).toHaveAttribute('aria-pressed', 'true')
      await expect(
        page.raw.locator('[data-test="helm-scratchpads"]')
      ).toBeHidden()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      await input.fill(COMMAND_FIXTURE_SOURCE)
      await input.press('Enter')
      await expect(
        page.raw.getByRole('region', { name: 'Command output', exact: true })
      ).toContainText('fixture stdout before completion')
      await expect(
        page.raw.getByRole('region', { name: 'Command output', exact: true })
      ).toContainText('fixture stderr before completion')
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Running')
      await expect(javascriptMode).toBeDisabled()
      await expect(commandMode).toBeDisabled()
      await expect(input).toBeDisabled()
      expect(runner.calls.length).toBe(1)
      expect(runner.calls[0].expectedRuntime.appId).toBe(String(app.id))
      await expect(
        page.raw.locator('[data-test="helm-command-target"]')
      ).toContainText('Fixture worker')
      await expect(
        page.raw.locator('[data-test="helm-command-target"]')
      ).toContainText('Production')
      await assertCommandFitsViewport(page, expect)
      await page.screenshot(
        `${COMMAND_SCREENSHOTS}/streaming-desktop-light.png`
      )
      await page.inDarkMode()
      await page.screenshot(`${COMMAND_SCREENSHOTS}/streaming-desktop-dark.png`)
      const historyGate = new Promise((resolve) => {
        releaseHistory = resolve
      })
      await page.raw.route('**/helm/history?**', async (route) => {
        if (
          new URL(route.request().url()).searchParams.get('mode') === 'command'
        )
          await historyGate
        await route.continue()
      })
      finish({
        ...COMMAND_FIXTURE_RESULT,
        success: false,
        status: 'error',
        exitCode: 7
      })
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Failed')
      await expect(
        page.raw.locator('[data-test="helm-command-console"]')
      ).toContainText('exit 7')
      await expect(page.raw.getByText('exit 7', { exact: true })).toBeVisible()
      await expect(input).toBeFocused()
      await expect(javascriptMode).toBeEnabled()
      // Terminal controls unlock even when refreshing optional history is slow.
      releaseHistory()
      await javascriptMode.click()
      await expect(page.raw.locator('[data-test="helm-editor"]')).toHaveText(
        scratchpad
      )
      await commandMode.click()
      await expect(input).toHaveValue(COMMAND_FIXTURE_SOURCE)
      await page.resize(390, 844)
      await assertCommandFitsViewport(page, expect)
      await page.screenshot(`${COMMAND_SCREENSHOTS}/failed-mobile-dark.png`)
      await page.inLightMode()
      await page.screenshot(`${COMMAND_SCREENSHOTS}/failed-mobile-light.png`)
      await page.raw
        .getByRole('button', { name: 'Command history', exact: true })
        .click()
      await input.fill('node --version')
      const history = page.raw.locator('[aria-label="Command history entries"]')
      await history
        .getByRole('button')
        .filter({ hasText: COMMAND_FIXTURE_SOURCE })
        .click()
      await expect(input).toHaveValue(COMMAND_FIXTURE_SOURCE)
      await expect(input).toBeFocused()
      await expect(history).toBeHidden()
      expect(runner.calls.length).toBe(1)
      expect(page).toHaveNoSmoke()
    } finally {
      releaseHistory?.()
      finish?.(COMMAND_FIXTURE_RESULT)
      runner.restore()
    }
  }
)

test(
  'project Helm commands require a fresh production arm for Run again and ignore rapid repeated submissions',
  {
    browser: true,
    world: helmWorld('helm-command-browser-arming')
  },
  async (context) => {
    const { sails, page, expect } = context
    let finish
    const commandOutput = 'fixture'
    const commandResult = {
      ...COMMAND_FIXTURE_RESULT,
      outputBytes: Buffer.byteLength(commandOutput)
    }
    const runner = commandFixtureRunner(sails, async ({ onEvent }) => {
      onEvent({ type: 'started' })
      // Keep this synthetic stream consistent with the displayed command.
      onEvent({ type: 'stdout', text: commandOutput })
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    try {
      await openCommandFixture(context, { production: true })
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      await input.fill(COMMAND_FIXTURE_SOURCE)
      await page.raw.keyboard.down('Enter')
      const dialog = page.raw.getByRole('alertdialog', {
        name: 'Arm production command?'
      })
      await expect(dialog).toBeVisible()
      expect(runner.calls.length).toBe(0)
      await page.raw.keyboard.down('Enter')
      await expect(dialog).toBeVisible()
      await page.raw.keyboard.up('Enter')
      // Repeated Enter must not activate the warning's focused control.
      const repeatedWarningKey = await dialog.evaluate((element) => {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          repeat: true,
          bubbles: true,
          cancelable: true
        })
        element
          .querySelector('[data-test="helm-arm-writes"]')
          .dispatchEvent(event)
        return event.defaultPrevented
      })
      expect(repeatedWarningKey).toBe(true)
      await expect(dialog).toBeVisible()
      expect(runner.calls.length).toBe(0)
      // Playwright visibility includes opacity-zero elements; wait for the
      // actual enter transition so this artifact contains the warning.
      await expect(dialog.locator('..')).toHaveCSS('opacity', '1')
      await page.screenshot(
        `${COMMAND_SCREENSHOTS}/production-command-warning.png`
      )
      await page.key('Escape')
      await expect(dialog).toBeHidden()
      await expect(input).toBeFocused()
      await input.press('Enter')
      await expect(dialog).toBeVisible()
      await page.raw.locator('[data-test="helm-arm-writes"]').focus()
      await page.raw.keyboard.down('Enter')
      await expect(dialog).toBeHidden()
      await expect(input).toBeFocused()
      expect(runner.calls.length).toBe(0)
      await page.raw.keyboard.down('Enter')
      await expect(
        page.raw.locator('[data-test="helm-command-run"]')
      ).toHaveAccessibleName(/^Run command · \d+s$/)
      const repeatedArmedKey = await input.evaluate((element) => {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          repeat: true,
          bubbles: true,
          cancelable: true
        })
        element.dispatchEvent(event)
        return event.defaultPrevented
      })
      expect(repeatedArmedKey).toBe(true)
      expect(runner.calls.length).toBe(0)
      await page.raw.keyboard.up('Enter')
      // Arming only grants a short-lived token. A second deliberate key press
      // is still required, and holding that key cannot spend the token twice.
      await input.press('Enter')
      // Repeated key events while busy do not admit another command. Implicit
      // form submission is intentionally inert, including after IME commits.
      await input.evaluate((element) => {
        const form = element.closest('form')
        for (let n = 0; n < 4; n++) {
          element.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              bubbles: true,
              cancelable: true
            })
          )
          form.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true })
          )
        }
      })
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Running')
      expect(runner.calls.length).toBe(1)
      const output = page.raw.getByRole('region', {
        name: 'Command output',
        exact: true
      })
      await expect(output).toHaveText(commandOutput)
      finish(commandResult)
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Completed')
      await expect(output).toHaveText(commandOutput)
      await expect(
        page.raw.locator('[data-test="helm-command-console"]')
      ).toContainText('exit 0')
      await expect(
        page.raw.locator('[data-test="helm-command-run"]')
      ).toHaveAccessibleName('Run again')
      await page.screenshot(
        `${COMMAND_SCREENSHOTS}/completed-production-command.png`
      )
      await page.click('@helm-command-run')
      await expect(dialog).toBeVisible()
      expect(runner.calls.length).toBe(1)
      await page.click('@helm-arm-writes')
      await expect(dialog).toBeHidden()
      await input.fill('node --version')
      await input.press('Enter')
      await expect(dialog).toBeVisible()
      expect(runner.calls.length).toBe(1)
      await page.key('Escape')
      expect(page).toHaveNoSmoke()
    } finally {
      await page.raw.keyboard.up('Enter')
      finish?.(commandResult)
      runner.restore()
    }
  }
)

test(
  'project Helm command help is keyboard accessible and dismisses without running the draft',
  {
    browser: true,
    world: helmWorld('helm-command-browser-help')
  },
  async (context) => {
    const { sails, page, expect } = context
    const runner = commandFixtureRunner(
      sails,
      async () => COMMAND_FIXTURE_RESULT
    )
    let inspectionRequests = 0
    page.raw.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/helm/inspect-source'))
        inspectionRequests++
    })
    try {
      await openCommandFixture(context)
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      const trigger = page.raw.getByRole('button', {
        name: 'Command help',
        exact: true
      })
      const help = page.raw.locator('#helm-command-help')
      await input.fill(COMMAND_FIXTURE_SOURCE)
      await expect(
        page.raw.locator('[data-test="helm-command-target"]')
      ).toHaveCSS('font-size', '14px')
      for (const [width, height, key] of [
        [1440, 900, 'Enter'],
        [390, 844, 'Space']
      ]) {
        await page.resize(width, height)
        await expect(help).toBeHidden()
        await trigger.focus()
        await trigger.press(key)
        await expect(help).toBeVisible()
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(trigger).toHaveAttribute(
          'aria-controls',
          'helm-command-help'
        )
        await expect(help).toContainText('Commands are saved')
        await expect(help).toContainText('output isn’t')
        await expect(help).toContainText('environment variables')
        const bounds = await help.boundingBox()
        expect(bounds.x >= 0 && bounds.x + bounds.width <= width + 1).toBe(true)
        await page.key('Escape')
        await expect(help).toBeHidden()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await expect(trigger).toBeFocused()
        await trigger.press(key)
        await expect(help).toBeVisible()
        // On mobile the help can overlap the prompt; dismiss via the target
        // above it before returning to the editor.
        await page.raw.locator('[data-test="helm-command-target"]').click()
        await expect(help).toBeHidden()
        await input.click()
        await expect(input).toBeFocused()
        await expect(input).toHaveValue(COMMAND_FIXTURE_SOURCE)
        await assertCommandFitsViewport(page, expect)
      }
      await trigger.click()
      await expect(help).toBeVisible()
      await page.raw
        .getByRole('button', { name: 'JavaScript mode', exact: true })
        .click()
      await expect(help).toBeHidden()
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      await expect(help).toBeHidden()
      await expect(input).toBeFocused()
      await expect(input).toHaveValue(COMMAND_FIXTURE_SOURCE)
      expect(inspectionRequests).toBe(0)
      expect(runner.calls.length).toBe(0)
      expect(page).toHaveNoSmoke()
    } finally {
      runner.restore()
    }
  }
)

test(
  'project Helm command output retains source attribution after edits and history restoration',
  {
    browser: true,
    world: helmWorld('helm-command-browser-provenance')
  },
  async (context) => {
    const { sails, page, expect } = context
    const longValue = 'x'.repeat(16 * 1024)
    const longExpression = `'${longValue}'.length`
    const longSource = `node -p "${longExpression}"`
    const longOutput = `${longValue.length}\n`
    // Deterministic synthetic stdout matches every displayed Node expression.
    const outputs = new Map([
      ['1+1', '2\n'],
      ['2+2', '4\n'],
      [longExpression, longOutput]
    ])
    const runner = commandFixtureRunner(sails, async ({ argv, onEvent }) => {
      expect(outputs.has(argv[2])).toBe(true)
      const output = outputs.get(argv[2])
      onEvent({ type: 'started' })
      onEvent({ type: 'stdout', text: output })
      return {
        ...COMMAND_FIXTURE_RESULT,
        outputBytes: Buffer.byteLength(output)
      }
    })
    try {
      await openCommandFixture(context)
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      const output = page.raw.getByRole('region', {
        name: 'Command output',
        exact: true
      })
      const draft = page.raw.locator('[data-test="helm-command-draft"]')
      const provenance = page.raw.locator(
        '[data-test="helm-command-provenance"]'
      )
      const status = page.raw.locator('[data-test="helm-command-status"]')
      await input.fill('node -p 1+1')
      await input.press('Enter')
      await expect(status).toHaveText('Completed')
      await expect(output).toHaveText('2\n')
      await expect(draft).toBeHidden()
      const successfulExit = page.raw.getByText('exit 0', { exact: true })
      const details = page.raw.locator(
        'summary[aria-label="Execution details"]'
      )
      await expect(successfulExit).toBeHidden()
      await expect(details).toHaveAccessibleName('Execution details')
      await details.focus()
      await details.press('Enter')
      await expect(successfulExit).toBeVisible()
      await details.press('Enter')
      await expect(successfulExit).toBeHidden()

      await input.fill('node -p 2+2')
      await expect(draft).toHaveText('Draft changed · not run')
      await expect(draft).toBeVisible()
      await expect(provenance).toContainText('Output from')
      await expect(provenance).toContainText('node -p 1+1')
      await expect(provenance).toBeVisible()
      await expect(output).toHaveText('2\n')
      await expect(
        page.raw.locator('[data-test="helm-command-run"]')
      ).toHaveAccessibleName('Run')
      expect(runner.calls.length).toBe(1)
      await input.press('Enter')
      await expect(status).toHaveText('Completed')
      await expect(output).toHaveText('4\n')
      await expect(draft).toBeHidden()
      expect(runner.calls.length).toBe(2)
      await input.fill('node --version')
      await expect(provenance).toContainText('node -p 2+2')
      await expect(output).toHaveText('4\n')
      expect(runner.calls.length).toBe(2)
      await page.raw
        .getByRole('button', { name: 'Command history', exact: true })
        .click()
      const history = page.raw.locator('[aria-label="Command history entries"]')
      await history
        .getByRole('button')
        .filter({ hasText: 'node -p 1+1' })
        .click()
      await expect(history).toBeHidden()
      await expect(input).toHaveValue('node -p 1+1')
      await expect(input).toBeFocused()
      await expect(draft).toHaveText('Draft changed · not run')
      await expect(provenance).toContainText('node -p 2+2')
      await expect(output).toHaveText('4\n')
      expect(runner.calls.length).toBe(2)

      await page.resize(390, 844)
      await input.fill(longSource)
      await input.press('Enter')
      await expect(status).toHaveText('Completed')
      await expect(output).toHaveText(longOutput)
      expect(runner.calls.length).toBe(3)
      await input.fill('node --version')
      await expect(draft).toHaveText('Draft changed · not run')
      await expect(provenance).toContainText(longSource)
      await expect(provenance).toBeVisible()
      const bounds = await provenance.evaluate((element) => {
        const output = document.querySelector('[aria-label="Command output"]')
        return {
          provenanceHeight: element.getBoundingClientRect().height,
          provenanceClientHeight: element.clientHeight,
          provenanceScrollHeight: element.scrollHeight,
          outputHeight: output.getBoundingClientRect().height,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth
        }
      })
      expect(bounds.provenanceHeight > 0 && bounds.provenanceHeight <= 81).toBe(
        true
      )
      expect(
        bounds.provenanceScrollHeight > bounds.provenanceClientHeight
      ).toBe(true)
      expect(bounds.outputHeight >= 160).toBe(true)
      expect(bounds.documentWidth <= bounds.viewportWidth).toBe(true)
      await provenance.focus()
      await expect(provenance).toBeFocused()
      await provenance.press('End')
      await page.raw.waitForFunction(
        () =>
          document.querySelector('[data-test="helm-command-provenance"]')
            .scrollTop > 0
      )
      await expect(output).toHaveText(longOutput)
      await assertCommandFitsViewport(page, expect)
      expect(runner.calls.length).toBe(3)
      expect(page).toHaveNoSmoke()
    } finally {
      runner.restore()
    }
  }
)

test(
  'project Helm command history restore closes and focuses the draft without executing or keeping a production arm',
  {
    browser: true,
    world: helmWorld('helm-command-browser-history-restore')
  },
  async (context) => {
    const { sails, page, expect } = context
    const source = 'node -p 1+1'
    const runner = commandFixtureRunner(sails, async ({ onEvent }) => {
      onEvent({ type: 'started' })
      onEvent({ type: 'stdout', text: '2\n' })
      return { ...COMMAND_FIXTURE_RESULT, outputBytes: 2 }
    })
    let inspectionRequests = 0
    page.raw.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/helm/inspect-source'))
        inspectionRequests++
    })
    try {
      await openCommandFixture(context, { production: true })
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      const submit = page.raw.locator('[data-test="helm-command-run"]')
      const dialog = page.raw.getByRole('alertdialog', {
        name: 'Arm production command?'
      })
      const history = page.raw.locator('[aria-label="Command history entries"]')
      await input.fill(source)
      await input.press('Enter')
      await expect(dialog).toBeVisible()
      await page.click('@helm-arm-writes')
      await expect(dialog).toBeHidden()
      expect(runner.calls.length).toBe(0)
      await input.press('Enter')
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Completed')
      expect(runner.calls.length).toBe(1)

      await input.fill('node -p 2+2')
      await input.press('Enter')
      await expect(dialog).toBeVisible()
      await page.key('Escape')
      await expect(dialog).toBeHidden()
      await expect(
        page.raw.locator('[data-test="helm-command-draft"]')
      ).toHaveText('Draft changed · not run')
      await expect(
        page.raw.locator('[data-test="helm-command-provenance"]')
      ).toContainText(source)
      await expect(
        page.raw.getByRole('region', { name: 'Command output', exact: true })
      ).toHaveText('2\n')
      expect(runner.calls.length).toBe(1)

      // A changed source and then the exact same source both invalidate an arm
      // when explicitly loaded from history. Assigning equal text must not rely
      // on the source watcher firing.
      for (const draft of ['node -p 2+2', source]) {
        await input.fill(draft)
        await input.press('Enter')
        await expect(dialog).toBeVisible()
        await page.click('@helm-arm-writes')
        await expect(dialog).toBeHidden()
        await expect(submit).toHaveAccessibleName(/^Run command · \d+s$/)
        if (draft !== source) {
          // Inspection and arming did not run this edited draft. The previous
          // output must retain its source attribution throughout that flow.
          await expect(
            page.raw.locator('[data-test="helm-command-draft"]')
          ).toHaveText('Draft changed · not run')
          await expect(
            page.raw.locator('[data-test="helm-command-provenance"]')
          ).toContainText(source)
        }
        const beforeRestore = inspectionRequests
        await page.raw
          .getByRole('button', { name: 'Command history', exact: true })
          .click()
        await history.getByRole('button').filter({ hasText: source }).click()
        await expect(history).toBeHidden()
        await expect(input).toHaveValue(source)
        await expect(input).toBeFocused()
        await expect(submit).toHaveAccessibleName('Run again')
        await expect(dialog).toBeHidden()
        expect(inspectionRequests).toBe(beforeRestore)
        expect(runner.calls.length).toBe(1)
        await input.press('Enter')
        await expect(dialog).toBeVisible()
        expect(runner.calls.length).toBe(1)
        await page.key('Escape')
        await expect(dialog).toBeHidden()
      }
      await expect(
        page.raw.getByRole('region', { name: 'Command output', exact: true })
      ).toHaveText('2\n')
      expect(page).toHaveNoSmoke()
    } finally {
      runner.restore()
    }
  }
)

test(
  'project Helm command prompt accepts deliberate single-line input and keeps a mobile submit affordance',
  {
    browser: true,
    world: helmWorld('helm-command-browser-prompt')
  },
  async (context) => {
    const { sails, page, expect } = context
    const runner = commandFixtureRunner(sails, async ({ onEvent }) => {
      onEvent({ type: 'started' })
      onEvent({ type: 'stdout', text: 'fixture' })
      return { ...COMMAND_FIXTURE_RESULT, outputBytes: 7 }
    })
    let inspectionRequests = 0
    page.raw.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/helm/inspect-source'))
        inspectionRequests++
    })
    try {
      await openCommandFixture(context)
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      const submit = page.raw.locator('[data-test="helm-command-run"]')
      await expect(input).toBeFocused()
      await expect(submit).toHaveAccessibleName('Run')
      await expect(submit).toBeDisabled()
      await input.press('Enter')
      await input.fill('   ')
      await input.press('Enter')
      await expect(submit).toBeDisabled()
      expect(inspectionRequests).toBe(0)

      await input.fill(COMMAND_FIXTURE_SOURCE)
      for (const key of ['Shift+Enter', 'Alt+Enter', 'ControlOrMeta+Enter'])
        await input.press(key)
      // Exercise both modern IME events and the keyCode 229 fallback. Synthetic
      // composition does not claim to reproduce an operating-system IME.
      const guardedKeys = await input.evaluate((element) => {
        element.dispatchEvent(new CompositionEvent('compositionstart'))
        const composing = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
          isComposing: true
        })
        element.dispatchEvent(composing)
        element.dispatchEvent(new CompositionEvent('compositionend'))
        const legacy = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 229,
          bubbles: true,
          cancelable: true
        })
        element.dispatchEvent(legacy)
        element.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
        )
        const implicitSubmit = new Event('submit', {
          bubbles: true,
          cancelable: true
        })
        element.closest('form').dispatchEvent(implicitSubmit)
        return [
          composing.defaultPrevented,
          legacy.defaultPrevented,
          implicitSubmit.defaultPrevented
        ]
      })
      // Preserve the browser's candidate commit while making its implicit
      // submission inert; the user still needs a fresh deliberate action.
      expect(guardedKeys).toEqual([false, false, true])
      await expect(input).toHaveValue(COMMAND_FIXTURE_SOURCE)
      expect(inspectionRequests).toBe(0)
      expect(runner.calls.length).toBe(0)

      // Use the real clipboard/default paste path: single-line inputs otherwise
      // silently strip newlines and concatenate distinct commands.
      await page.raw
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'])
      for (const separator of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
        await page.raw.evaluate(
          (text) => navigator.clipboard.writeText(text),
          `node --version${separator}node --help`
        )
        await input.focus()
        await input.press('ControlOrMeta+A')
        await input.press('ControlOrMeta+V')
        await expect(input).toHaveValue(COMMAND_FIXTURE_SOURCE)
        await expect(
          page.raw.getByText('Paste one command on a single line.', {
            exact: true
          })
        ).toBeVisible()
        await expect(submit).toBeDisabled()
        await input.press('Enter')
        expect(inspectionRequests).toBe(0)
        expect(runner.calls.length).toBe(0)
      }
      expect(inspectionRequests).toBe(0)
      expect(runner.calls.length).toBe(0)
      await page.raw.evaluate(
        (text) => navigator.clipboard.writeText(text),
        'node --version'
      )
      await input.press('ControlOrMeta+A')
      await input.press('ControlOrMeta+V')
      await expect(input).toHaveValue('node --version')
      expect(inspectionRequests).toBe(0)
      expect(runner.calls.length).toBe(0)

      await page.resize(390, 844)
      await assertCommandFitsViewport(page, expect)
      await expect(submit).toBeVisible()
      const affordance = await submit.boundingBox()
      expect(affordance.width >= 44 && affordance.height >= 44).toBe(true)
      const inputBorders = await input.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          bottom: style.borderBottomWidth,
          top: style.borderTopWidth,
          left: style.borderLeftWidth,
          right: style.borderRightWidth,
          prompt: getComputedStyle(element.closest('form')).borderBottomWidth
        }
      })
      expect(inputBorders).toEqual({
        bottom: '0px',
        top: '0px',
        left: '0px',
        right: '0px',
        prompt: '0px'
      })
      // Focus is visible on the prompt itself without reintroducing an input
      // box or horizontal separator. Check both themes and an actual blur.
      const marker = page.raw.locator('label[for="helm-command-input"]')
      for (const dark of [false, true]) {
        if (dark) await page.inDarkMode()
        else await page.inLightMode()
        await input.focus()
        await expect(input).toBeFocused()
        await expect(marker).toHaveCSS('text-decoration-line', 'underline')
        const nativeCaret = await input.evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            color: style.caretColor,
            textColor: style.color,
            type: element.type,
            tag: element.tagName
          }
        })
        expect(nativeCaret.tag).toBe('INPUT')
        expect(nativeCaret.type).toBe('text')
        expect(nativeCaret.color).toBe(nativeCaret.textColor)
        expect(nativeCaret.color).not.toBe('rgba(0, 0, 0, 0)')
        const focusedColor = await marker.evaluate(
          (element) => getComputedStyle(element).color
        )
        await page.raw
          .getByRole('button', { name: 'Command help', exact: true })
          .focus()
        await expect(marker).toHaveCSS('text-decoration-line', 'none')
        const unfocusedColor = await marker.evaluate(
          (element) => getComputedStyle(element).color
        )
        expect(focusedColor === unfocusedColor).toBe(false)
      }
      // A touch-friendly fallback remains usable without a physical Enter key.
      await input.fill(COMMAND_FIXTURE_SOURCE)
      await submit.click()
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Completed')
      expect(inspectionRequests).toBe(1)
      expect(runner.calls.length).toBe(1)
      expect(runner.calls[0].argv).toEqual([
        'node',
        '-e',
        "process.stdout.write('fixture')"
      ])
      await expect(submit).toHaveAccessibleName('Run again')
      // Capture the same live control once, then queue clicks in a single turn
      // before Vue removes it. Only one attempt may pass the busy guard.
      await submit.evaluate((element) => {
        for (let n = 0; n < 4; n++) element.click()
      })
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Completed')
      expect(inspectionRequests).toBe(2)
      expect(runner.calls.length).toBe(2)
      expect(page).toHaveNoSmoke()
    } finally {
      runner.restore()
    }
  }
)

test(
  'project Helm command prompt ignores held Enter after completion until a fresh press',
  {
    browser: true,
    world: helmWorld('helm-command-browser-held-enter')
  },
  async (context) => {
    const { sails, page, expect } = context
    const runner = commandFixtureRunner(sails, async ({ onEvent }) => {
      onEvent({ type: 'started' })
      onEvent({ type: 'stdout', text: 'fixture' })
      return { ...COMMAND_FIXTURE_RESULT, outputBytes: 7 }
    })
    try {
      await openCommandFixture(context)
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      await input.fill(COMMAND_FIXTURE_SOURCE)
      await page.raw.keyboard.down('Enter')
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Completed')
      await expect(input).toBeFocused()
      expect(runner.calls.length).toBe(1)
      // A second down without up is an actual browser repeat event, including
      // its native implicit-submit behavior, after the input becomes enabled.
      for (let n = 0; n < 3; n++) await page.raw.keyboard.down('Enter')
      const prevented = await input.evaluate((element) => {
        const repeat = new KeyboardEvent('keydown', {
          key: 'Enter',
          repeat: true,
          bubbles: true,
          cancelable: true
        })
        element.dispatchEvent(repeat)
        return repeat.defaultPrevented
      })
      expect(prevented).toBe(true)
      expect(runner.calls.length).toBe(1)
      await page.raw.keyboard.up('Enter')
      await input.press('Enter')
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Completed')
      expect(runner.calls.length).toBe(2)
      expect(page).toHaveNoSmoke()
    } finally {
      await page.raw.keyboard.up('Enter')
      runner.restore()
    }
  }
)

test(
  'project Helm Stop waits for command terminal evidence and navigation aborts the old selected target',
  {
    browser: true,
    world: helmWorld('helm-command-browser-stop')
  },
  async (context) => {
    const { sails, page, expect } = context
    let finish
    let signal
    let waitForAbort
    const runner = commandFixtureRunner(sails, async (input) => {
      signal = input.signal
      waitForAbort = new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true })
      )
      input.onEvent({ type: 'started' })
      input.onEvent({ type: 'stdout', text: 'fixture command still running\n' })
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    try {
      const { current, path } = await openCommandFixture(context)
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      await input.fill(COMMAND_FIXTURE_SOURCE)
      await input.press('Enter')
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Running')
      await page.raw
        .getByRole('button', { name: 'Stop command', exact: true })
        .click()
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Stopping')
      await expect(
        page.raw.getByRole('button', { name: 'Stop command', exact: true })
      ).toBeDisabled()
      await waitForAbort
      expect(signal.aborted).toBe(true)
      await expect(input).toBeDisabled()
      await page.screenshot(`${COMMAND_SCREENSHOTS}/awaiting-stop-evidence.png`)
      finish({
        ...COMMAND_FIXTURE_RESULT,
        success: false,
        status: 'cancelled',
        exitCode: null,
        signal: 'SIGTERM'
      })
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Cancelled')
      await expect(
        page.raw.locator('[data-test="helm-command-console"]')
      ).toContainText('SIGTERM')
      await expect(
        page.raw.locator('[data-test="helm-command-console"]')
      ).not.toContainText('exit 0')
      await input.press('Enter')
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Running')
      const abandoned = signal
      const secondApp = await context.world.create('app').with({
        environment: current.environments.production.id,
        slug: 'second-command-fixture',
        isDefault: false,
        name: 'Second command fixture',
        status: 'running',
        containerName: 'sounding-second-command-fixture'
      })
      await page.goto(
        path.replace(/appSlug=[^&]+/, `appSlug=${secondApp.slug}`)
      )
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      await expect(input).toHaveValue('')
      await expect(
        page.raw.locator('[data-test="helm-command-target"]')
      ).toContainText('Second command fixture')
      await waitForAbort
      expect(abandoned.aborted).toBe(true)
      finish({
        ...COMMAND_FIXTURE_RESULT,
        success: false,
        status: 'cancelled',
        exitCode: null,
        signal: 'SIGTERM'
      })
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Ready')
      await expect(
        page.raw.getByRole('region', { name: 'Command output', exact: true })
      ).not.toContainText('fixture command still running')
      await page.raw
        .getByRole('navigation', { name: 'Breadcrumb', exact: true })
        .getByRole('link', { name: 'projects', exact: true })
        .click()
      await page.raw.waitForURL((url) => url.pathname === '/')
      await expect(
        page.raw.locator('[data-test="helm-command-console"]')
      ).toHaveCount(0)
      expect(runner.calls.length).toBe(2)
      expect(page).toHaveNoSmoke()
    } finally {
      finish?.({
        ...COMMAND_FIXTURE_RESULT,
        success: false,
        status: 'unconfirmed',
        terminationConfirmed: false,
        exitCode: null
      })
      runner.restore()
    }
  }
)

test(
  'project Helm command transport loss remains unconfirmed and does not invent a successful Stop',
  {
    browser: true,
    world: helmWorld('helm-command-browser-unconfirmed')
  },
  async (context) => {
    const { page, expect } = context
    await openCommandFixture(context)
    // An incomplete accepted stream exercises the browser's real fetch/NDJSON path.
    await page.raw.route('**/helm/commands', async (route) => {
      const { executionId } = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body:
          [
            { type: 'accepted', executionId },
            { type: 'started' },
            { type: 'stdout', text: 'last observed fixture output\n' }
          ]
            .map(JSON.stringify)
            .join('\n') + '\n'
      })
    })
    await page.raw
      .getByRole('button', { name: 'Command mode', exact: true })
      .click()
    const input = page.raw.getByRole('textbox', {
      name: 'Helm command',
      exact: true
    })
    await input.fill(COMMAND_FIXTURE_SOURCE)
    await input.press('Enter')
    await expect(
      page.raw.locator('[data-test="helm-command-status"]')
    ).toHaveText('Unconfirmed')
    await expect(
      page.raw.locator('[data-test="helm-command-error"]')
    ).toContainText('Check the selected app')
    await expect(
      page.raw.getByRole('region', { name: 'Command output', exact: true })
    ).toContainText('last observed fixture output')
    await expect(
      page.raw.locator('[data-test="helm-command-console"]')
    ).not.toContainText('exit 0')
    await expect(
      page.raw.locator('[data-test="helm-command-status"]')
    ).not.toHaveText('Cancelled')
    await page.screenshot(`${COMMAND_SCREENSHOTS}/transport-unconfirmed.png`)
    expect(page).toHaveNoSmoke()
  }
)

test(
  'project Helm preparing commands cannot claim Stop before admission and ignores inspection after navigation',
  {
    browser: true,
    world: helmWorld('helm-command-browser-admission')
  },
  async (context) => {
    const { page, expect } = context
    await openCommandFixture(context)
    let releaseInspection
    const inspectionGate = new Promise((resolve) => {
      releaseInspection = resolve
    })
    let sawInspection
    const inspectionEntered = new Promise((resolve) => {
      sawInspection = resolve
    })
    let commandRequests = 0
    await page.raw.route('**/helm/inspect-source', async (route) => {
      sawInspection()
      await inspectionGate
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'command',
          requiresWriteArm: false,
          classification: { findings: [] }
        })
      })
    })
    await page.raw.route('**/helm/commands', async (route) => {
      commandRequests++
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'A stale inspection must never dispatch a command'
        })
      })
    })
    try {
      await page.raw
        .getByRole('button', { name: 'Command mode', exact: true })
        .click()
      const input = page.raw.getByRole('textbox', {
        name: 'Helm command',
        exact: true
      })
      await input.fill(COMMAND_FIXTURE_SOURCE)
      await input.press('Enter')
      await inspectionEntered
      await expect(
        page.raw.locator('[data-test="helm-command-status"]')
      ).toHaveText('Preparing')
      await expect(
        page.raw.getByRole('button', { name: 'Stop command', exact: true })
      ).toBeDisabled()
      await expect(
        page.raw.getByRole('button', { name: 'JavaScript mode', exact: true })
      ).toBeDisabled()
      await expect(input).toBeDisabled()
      await page.screenshot(
        `${COMMAND_SCREENSHOTS}/pre-admission-preparing.png`
      )
      // Follow a real Inertia link so Vue unmount cleanup, rather than a full
      // browser reload, must make the late inspection harmless.
      await page.raw
        .getByRole('navigation', { name: 'Breadcrumb', exact: true })
        .getByRole('link', { name: 'projects', exact: true })
        .click()
      await expect(
        page.raw.locator('[data-test="helm-command-console"]')
      ).toHaveCount(0)
      const inspectionFinished = page.raw.waitForResponse(
        '**/helm/inspect-source'
      )
      releaseInspection()
      await inspectionFinished
      expect(commandRequests).toBe(0)
      expect(page).toHaveNoSmoke()
    } finally {
      releaseInspection()
    }
  }
)

test(
  'project Helm command output keeps markup inert and visibly bounds hostile tiny channel chunks',
  {
    browser: true,
    world: helmWorld('helm-command-browser-output-bounds')
  },
  async (context) => {
    const { page, expect } = context
    await openCommandFixture(context)
    await page.raw.route('**/helm/commands', async (route) => {
      const { executionId } = route.request().postDataJSON()
      const events = [
        { type: 'accepted', executionId },
        { type: 'started' },
        {
          type: 'stdout',
          text: '\u001b[31m<img src=x onerror="window.helmFixtureExecuted=true">\u001b[0m\n'
        }
      ]
      for (let n = 0; n < 1100; n++)
        events.push({
          type: n % 2 ? 'stdout' : 'stderr',
          text: `fragment-${n}\n`
        })
      events.push({
        type: 'result',
        executionId,
        result: COMMAND_FIXTURE_RESULT
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: events.map(JSON.stringify).join('\n') + '\n'
      })
    })
    await page.raw
      .getByRole('button', { name: 'Command mode', exact: true })
      .click()
    const input = page.raw.getByRole('textbox', {
      name: 'Helm command',
      exact: true
    })
    await input.fill(COMMAND_FIXTURE_SOURCE)
    await input.press('Enter')
    await expect(
      page.raw.locator('[data-test="helm-command-status"]')
    ).toHaveText('Completed')
    const output = page.raw.getByRole('region', {
      name: 'Command output',
      exact: true
    })
    await expect(output).toContainText(
      '<img src=x onerror="window.helmFixtureExecuted=true">'
    )
    await expect(output.locator('img')).toHaveCount(0)
    expect(await page.script(() => Boolean(window.helmFixtureExecuted))).toBe(
      false
    )
    expect((await output.textContent()).includes('\u001b')).toBe(false)
    expect(await output.locator('pre > span').count()).toBe(1024)
    await expect(
      page.raw.locator('[data-test="helm-command-console"]')
    ).toContainText('Output truncated')
    await expect(output).not.toContainText('fragment-1099')
    await page.screenshot(`${COMMAND_SCREENSHOTS}/bounded-inert-output.png`)
    expect(page).toHaveNoSmoke()
  }
)
