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

    await page.click('@helm-scratchpad-actions-trigger')
    await page.click('@helm-scratchpad-actions-rename')
    await page.fill('@helm-scratchpad-rename', 'Creator audit')
    await page.key('Enter')
    expect((await tabs.nth(1).textContent()).includes('Creator audit')).toBe(
      true
    )

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
    await page.wait('@confirm-modal')
    await page.raw
      .locator('[data-test="confirm-modal"]')
      .getByRole('button', { name: 'Close scratchpad', exact: true })
      .click()
    expect(await tabs.count()).toBe(2)

    const storedBeforeReload = await page.raw.evaluate(() =>
      window.localStorage.getItem('slipway:helm-scratchpads')
    )
    expect(storedBeforeReload.includes(returnedValue)).toBe(false)

    await page.reload()
    expect(await tabs.count()).toBe(2)
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
    const foreignTab = page.raw.getByRole('tab', { name: /Billing repair/ })
    expect((await foreignTab.textContent()).includes('Production')).toBe(true)
    await foreignTab.click()
    await page.raw
      .locator('[data-test="confirm-modal"]')
      .waitFor({ state: 'visible' })
    expect(page).toSee('Open production scratchpad?')
    expect(page).toSee('Billing / Production / billing.app')
    await page.raw.waitForTimeout(250)
    await page.screenshot(
      '.tmp/issue-276-helm-production-switch-warning-dark.png'
    )
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
  'Helm keeps both panes usable with oversized output on mobile',
  { browser: 'mobile', world: helmWorld('helm-layout-mobile') },
  async ({ sails, world, login, page, expect }) => {
    await openHelmWithMockedExecution({ sails, world, login, page })

    const layout = await measureHelm(page)
    expect(layout.page.height <= layout.viewportHeight).toBe(true)
    expect(layout.editor.height > layout.workspace.height * 0.25).toBe(true)
    expect(layout.output.height > layout.workspace.height * 0.25).toBe(true)
    expect(layout.outputScrollHeight > layout.outputClientHeight).toBe(true)

    await proveOutputScrollsAndEditorStillRuns({ page, expect })

    await page.click('@helm-mobile-menu')
    await page.wait('@mobile-team-name')
    await page.wait(350)
    const teamSelector = await page.script(() => {
      const label = document.querySelector('[data-test="mobile-team-name"]')
      const closeButton = document.querySelector(
        '[data-test="mobile-menu-close"]'
      )
      const labelBox = label.getBoundingClientRect()
      const closeButtonBox = closeButton.getBoundingClientRect()

      return {
        clientWidth: label.clientWidth,
        scrollWidth: label.scrollWidth,
        textOverflow: getComputedStyle(label).textOverflow,
        labelRight: labelBox.right,
        closeButtonLeft: closeButtonBox.left,
        title: label.title,
        text: label.textContent.trim()
      }
    })

    expect(teamSelector.scrollWidth > teamSelector.clientWidth).toBe(true)
    expect(teamSelector.textOverflow).toBe('ellipsis')
    expect(teamSelector.labelRight <= teamSelector.closeButtonLeft).toBe(true)
    expect(teamSelector.title).toBe(teamSelector.text)
    expect(page).toHaveNoSmoke()
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
          frames: ['    at new Script (node:vm:117:7)'],
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
    await page.screenshot('.tmp/issue-270-project-stack-light.png')

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
    await page.click('@helm-run')
    await page.wait('@helm-error')

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
  'Bosun Helm uses the same inline diagnostics for rejected promises',
  {
    browser: true,
    world: helmWorld('helm-inline-diagnostics-bosun')
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const submitted = []

    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route('**/api/v1/bosun/eval', async (route) => {
      const request = route.request().postDataJSON()
      submitted.push(request)
      const rejected = request.code.includes('Promise.reject')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          rejected
            ? failedHelmResult({
                message: 'No user',
                line: 1,
                column: 26,
                frames: ['    at node:vm:134:12']
              })
            : {
                success: true,
                value: { ready: true },
                logs: [],
                output: JSON.stringify({ ready: true }, null, 2),
                error: null,
                durationMs: 2,
                truncated: false
              }
        )
      })
    })

    await page.resize(1440, 900)
    await page.inDarkMode()
    await page.goto('/bosun?tab=console&mode=helm')
    await page.fill(
      '@bosun-helm-editor',
      "await Promise.reject(new Error('No user'))"
    )
    await page.click('@bosun-console-run')
    await page.wait('@bosun-helm-error')

    expectHelmSubmission(expect, submitted[0], {
      code: "await Promise.reject(new Error('No user'))",
      sourceStartLine: 1,
      sourceStartColumn: 1
    })
    expect(await page.raw.locator('.cm-lintRange-error').textContent()).toBe(
      'Error'
    )
    expect(await page.raw.locator('.cm-inline-diagnostic').textContent()).toBe(
      'Error: No user'
    )
    expect(
      await page.raw
        .locator('[data-test="bosun-helm-error-summary"]')
        .textContent()
    ).toBe('Error: No user')
    expect(
      await page.raw
        .locator('[data-test="bosun-helm-error-stack"]')
        .getAttribute('open')
    ).toBe(null)
    await page.screenshot('.tmp/issue-270-bosun-rejection-dark.png')

    await page.fill('@bosun-helm-editor', 'return { ready: true }')
    expect(await page.raw.locator('.cm-lintRange-error').count()).toBe(0)
    expect(await page.raw.locator('.cm-inline-diagnostic').count()).toBe(0)
    await page.click('@bosun-console-run')
    await page.wait('@bosun-helm-output')
    expect(await page.raw.locator('.cm-lintRange-error').count()).toBe(0)
    expect(page).toHaveNoSmoke()
  }
)

test(
  'Helm shows transient inline values and redacted query traces in both executors',
  {
    browser: true,
    world: helmWorld('helm-inspection-and-query-trace')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug
    const projectEndpoint = `/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`
    let projectExecution = 0

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'sounding-helm-inspection-app'
    })
    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route(`**${projectEndpoint}`, async (route) => {
      projectExecution += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          projectExecution === 1
            ? inspectedHelmResult({
                inspectionLine: 2,
                query: {
                  kind: 'waterline',
                  model: 'creator',
                  datastore: 'default',
                  method: 'find',
                  durationMs: 4,
                  status: 'success',
                  criteria: {
                    where: {
                      subscriptionStatus: '[value]'
                    }
                  }
                }
              })
            : {
                success: true,
                value: 2,
                logs: [],
                output: '2',
                error: null,
                durationMs: 1,
                truncated: false,
                inspections: [],
                queryTrace: null
              }
        )
      })
    })

    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )
    await page.fill(
      '@helm-editor',
      [
        '// @trace queries',
        "const creators = await Creator.find({ subscriptionStatus: 'active' }) // @inspect",
        'creators'
      ].join('\n')
    )
    await page.click('@helm-run')
    await page.raw.locator('.cm-inline-inspection').waitFor()
    await page.wait('@helm-queries')

    expect(
      await page.raw.locator('.cm-inline-inspection').textContent()
    ).toContain('Ada')
    expect(
      await page.raw.locator('[data-test="helm-query-list"]').textContent()
    ).toContain('creator.find')
    expect(
      await page.raw.locator('[data-test="helm-query-list"]').textContent()
    ).toContain('"subscriptionStatus":"[value]"')
    await page.screenshot(
      '.tmp/issue-275-project-inspection-query-trace-light.png'
    )

    await page.fill('@helm-editor', '1 + 1')
    expect(await page.raw.locator('.cm-inline-inspection').count()).toBe(0)
    await page.click('@helm-run')
    await page.wait('@helm-output')
    expect(await page.raw.locator('[data-test="helm-queries"]').count()).toBe(0)

    await page.raw.route('**/api/v1/bosun/eval', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          inspectedHelmResult({
            inspectionLine: 2,
            query: {
              kind: 'native',
              model: null,
              datastore: 'default',
              method: 'sendNativeQuery',
              durationMs: 2,
              status: 'success',
              statement: 'SELECT ? AS active_creators'
            }
          })
        )
      })
    })
    await page.inDarkMode()
    await page.goto('/bosun?tab=console&mode=helm')
    await page.fill(
      '@bosun-helm-editor',
      [
        '// @trace queries',
        "const creators = [{ firstName: 'Ada', lastName: 'Lovelace' }] // @inspect",
        'creators'
      ].join('\n')
    )
    await page.click('@bosun-console-run')
    await page.raw.locator('.cm-inline-inspection').waitFor()
    await page.wait('@bosun-helm-queries')

    expect(
      await page.raw
        .locator('[data-test="bosun-helm-query-list"]')
        .textContent()
    ).toContain('default.sendNativeQuery')
    await page.screenshot(
      '.tmp/issue-275-bosun-inspection-query-trace-dark.png'
    )
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
      const result = code.includes('nested')
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
    await tree.locator('summary').filter({ hasText: 'course' }).click()
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
  'Bosun Helm uses the same structured result viewer in dark mode',
  {
    browser: true,
    world: helmWorld('helm-structured-bosun')
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route('**/api/v1/bosun/eval', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(flatHelmResult())
      })
    })

    await page.resize(1440, 900)
    await page.inDarkMode()
    await page.goto('/bosun?tab=console&mode=helm')
    await page.fill('@bosun-helm-editor', 'await User.find().limit(3)')
    await page.click('@bosun-console-run')
    await page.wait('@bosun-helm-result-table')

    expect(
      await page.raw
        .locator('[data-test="bosun-helm-result-table"] tbody tr')
        .count()
    ).toBe(3)
    expect(
      await page.raw
        .locator('[data-test="bosun-helm-result-status"]')
        .textContent()
    ).toContain('3 rows')
    await page.screenshot('.tmp/issue-269-bosun-table-dark.png')
    expect(page).toHaveNoSmoke()
  }
)

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
  'Bosun Helm applies the same selection contract in dark mode',
  {
    browser: true,
    world: helmWorld('helm-selection-bosun')
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const submitted = []
    const selectedSource = [
      'await User.find()',
      '  .where({ isSuperAdmin: true })',
      '  .limit(1)'
    ].join('\n')
    const documentSource = [
      'const outsideSelection = "must not run"',
      selectedSource
    ].join('\n')

    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route('**/api/v1/bosun/eval', async (route) => {
      submitted.push(route.request().postDataJSON())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          value: [{ id: 1 }],
          logs: [],
          output: JSON.stringify([{ id: 1 }], null, 2),
          error: null,
          durationMs: 4,
          truncated: false
        })
      })
    })

    await page.resize(1440, 900)
    await page.inDarkMode()
    await page.goto('/bosun?tab=console&mode=helm')
    await page.fill('@bosun-helm-editor', documentSource)
    await selectFromSecondLine(page)

    expect(await page.script(() => window.getSelection().toString())).toBe(
      selectedSource
    )
    expect(
      await page.raw.locator('[data-test="bosun-console-run"]').textContent()
    ).toContain('Run selection')
    await page.screenshot('.tmp/issue-268-bosun-helm-selection-dark.png')

    const execution = page.raw.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes('/api/v1/bosun/eval')
    )
    await page.key('ControlOrMeta+Enter')
    expectHelmSubmission(expect, (await execution).postDataJSON(), {
      code: selectedSource,
      sourceStartLine: 2,
      sourceStartColumn: 1
    })
    await page.raw
      .locator('[data-test="bosun-console-run"]')
      .filter({ hasText: 'Run selection' })
      .waitFor()

    expect(submitted.length).toBe(1)
    expect(await page.script(() => window.getSelection().toString())).toBe(
      selectedSource
    )
    expect(
      await page.script(
        () =>
          document.activeElement?.matches('[data-test="bosun-helm-editor"]') ===
          true
      )
    ).toBe(true)
    expect(page).toHaveNoSmoke()
  }
)

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
    await page.raw.locator('[data-test="confirm-modal"]').waitFor()
    await page.raw
      .getByRole('button', { name: 'Clear history', exact: true })
      .click()
    await page.raw
      .locator('[data-test="confirm-modal"]')
      .waitFor({ state: 'detached' })
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
  'Bosun Helm shows the same stopped and partial-console states in dark mode',
  {
    browser: true,
    world: helmWorld('helm-cancellation-bosun')
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    let releaseExecution
    const executionCancelled = new Promise((resolve) => {
      releaseExecution = resolve
    })

    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route('**/api/v1/bosun/eval', async (route) => {
      await executionCancelled
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          cancelledResult(['found 12 users'], {
            durationMs: 812,
            logsPartial: true
          })
        )
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
        setTimeout(releaseExecution, 100)
      }
    )

    await page.resize(1440, 900)
    await page.inDarkMode()
    await page.goto('/bosun?tab=console&mode=helm')
    await page.fill(
      '@bosun-helm-editor',
      "console.log('found 12 users')\nawait new Promise(() => {})"
    )
    await page.click('@bosun-console-run')
    await page.raw
      .locator('[data-test="bosun-console-run"]')
      .filter({ hasText: 'Stop' })
      .waitFor()
    await page.wait(250)
    await page.screenshot('.tmp/issue-271-bosun-running-stop-dark.png')

    await page.click('@bosun-console-run')
    await page.raw
      .locator('[data-test="bosun-helm-result-status"]')
      .filter({ hasText: 'Partial console' })
      .waitFor()
    expect(
      await page.raw
        .locator('[data-test="bosun-helm-result-status"]')
        .textContent()
    ).toContain('Cancelled')
    expect(
      await page.raw.locator('[data-test="bosun-helm-logs"]').textContent()
    ).toContain('partial')
    await page.screenshot('.tmp/issue-271-bosun-cancelled-dark.png')
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

    await page.raw.route('**/helm/completions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(HELM_COMPLETION_METADATA)
      })
    })
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

test(
  'Bosun Helm completes helper and config namespaces in dark mode',
  {
    browser: true,
    world: helmWorld('helm-completion-bosun')
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw.route('**/api/v1/bosun/helm/completions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(HELM_COMPLETION_METADATA)
      })
    })

    await page.resize(1440, 900)
    await page.inDarkMode()
    await page.goto('/bosun?tab=console&mode=helm')

    await page.fill('@bosun-helm-editor', 'sails.helpers.ma')
    await page.raw.locator('.cm-tooltip-autocomplete').waitFor()
    expect(
      await page.raw.locator('.cm-tooltip-autocomplete').textContent()
    ).toContain('mail')
    await page.screenshot('.tmp/issue-272-bosun-helper-completion-dark.png')

    await page.key('Escape')
    await page.fill('@bosun-helm-editor', 'sails.config.cu')
    await page.raw.locator('.cm-tooltip-autocomplete').waitFor()
    expect(
      await page.raw.locator('.cm-tooltip-autocomplete').textContent()
    ).toContain('custom')
    await page.screenshot('.tmp/issue-272-bosun-config-completion-dark.png')
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
