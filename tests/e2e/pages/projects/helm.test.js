const { test } = require('sounding')

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
        body: JSON.stringify({
          success: true,
          output:
            executionCount === 1
              ? oversizedOutput()
              : JSON.stringify({ ready: true }, null, 2)
        })
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
    ).includes('"ready": true')
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
  'Helm renders structured runtime errors as source-oriented text',
  {
    browser: true,
    world: helmWorld('helm-structured-error')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const projectSlug = current.projects.deploymentTarget.slug
    const environmentSlug = current.environments.production.slug

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
    await page.raw.route(
      `**/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            value: null,
            logs: ['checking creator'],
            output: 'checking creator',
            error: {
              name: 'TypeError',
              message: "Cannot read properties of null (reading 'publicId')",
              stack: 'TypeError at helm-input.js:2:9',
              line: 2,
              column: 9
            },
            durationMs: 4,
            truncated: false
          })
        })
      }
    )

    await page.goto(
      `/projects/${projectSlug}/environments/${environmentSlug}/helm`
    )
    await page.fill('@helm-editor', 'const creator = null\ncreator.publicId')
    await page.click('@helm-run')
    await page.wait('@helm-error')

    const errorText = await page.raw
      .locator('[data-test="helm-error"]')
      .textContent()
    expect(errorText).toContain('checking creator')
    expect(errorText).toContain(
      "TypeError: Cannot read properties of null (reading 'publicId') (2:9)"
    )
    expect(errorText.includes('[object Object]')).toBe(false)
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

    expect(submitted[0]).toEqual({
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
    expect((await rerun).postDataJSON()).toEqual(submitted[0])
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
    expect((await execution).postDataJSON()).toEqual({
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
