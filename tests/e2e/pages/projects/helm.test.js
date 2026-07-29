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
    expect(
      await page.raw.locator('[data-test="helm-history-entry"]').count()
    ).toBe(2)
    await page.click('@helm-clear-history')
    expect(await page.raw.locator('[data-test="helm-history"]').count()).toBe(0)
    expect(page).toHaveNoSmoke()
  }
)

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
    expect((await page.raw.locator('.cm-executed-range').count()) > 0).toBe(
      true
    )
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
    const historyText = await page.raw
      .locator('[data-test="helm-history-entry"]')
      .first()
      .textContent()
    expect(historyText).toContain('await Creator.find()')
    expect(historyText.includes('outsideSelection')).toBe(false)

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
    expect(
      await page.raw
        .locator('[data-test="helm-history-entry"] span')
        .last()
        .getAttribute('class')
    ).toContain('bg-gray-400')
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
