const { test } = require('sounding')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')

// This capture intentionally uses only selectors present in the pinned baseline
// and the refinement. Behavior regressions belong in the owning Helm page file.
const SOURCE = 'node -p 1+1'
const OUTPUT = '2\n'
const SUMMARY_EXPRESSION =
  "JSON.stringify({status:'ready',services:['web','worker'],queueDepth:0},null,2)"
const SUMMARY_SOURCE = `node -p "${SUMMARY_EXPRESSION}"`
const SUMMARY_OUTPUT =
  JSON.stringify(
    { status: 'ready', services: ['web', 'worker'], queueDepth: 0 },
    null,
    2
  ) + '\n'
const EDITED_SOURCE = 'node -p 2+2'
const FIXTURES = [
  { source: SOURCE, argv: ['node', '-p', '1+1'], stdout: OUTPUT },
  {
    source: SUMMARY_SOURCE,
    argv: ['node', '-p', SUMMARY_EXPRESSION],
    stdout: SUMMARY_OUTPUT
  }
]
const VARIANT = process.env.HELM_PROMPT_VARIANT || 'current'
const ROOT = path.resolve('.tmp/screenshots/helm-terminal-prompt', VARIANT)
const SAMPLE_COUNT = 9

async function markEventToFrame(locator, eventName) {
  await locator.evaluate((element, name) => {
    window.__helmPromptFrame = new Promise((resolve) => {
      element.addEventListener(
        name,
        () => {
          const start = performance.now()
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve(performance.now() - start))
          })
        },
        { once: true, capture: true }
      )
    })
  }, eventName)
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    samplesMs: samples,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted.at(-1)
  }
}

test(
  'Helm terminal prompt paired capture uses matching fixture output and browser interaction samples',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'helm-terminal-prompt-review',
          name: 'Helm terminal prompt'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const environment = current.environments.production
    const app = current.apps.web
    const originalRunner = sails.helpers.helm.executeCommandInContainer
    let executions = 0
    let historyEntries = []
    sails.helpers.helm.executeCommandInContainer = {
      async with(input) {
        const fixture = FIXTURES.find(
          (item) => JSON.stringify(item.argv) === JSON.stringify(input.argv)
        )
        expect(Boolean(fixture)).toBe(true)
        executions++
        input.onEvent({ type: 'started' })
        input.onEvent({ type: 'stdout', text: fixture.stdout })
        historyEntries.unshift({
          id: executions,
          source: fixture.source,
          status: 'success',
          durationMs: 24
        })
        return {
          success: true,
          status: 'success',
          exitCode: 0,
          signal: null,
          exitStatusObserved: true,
          terminationConfirmed: true,
          terminationScope: 'foreground-process-group',
          durationMs: 24,
          outputBytes: Buffer.byteLength(fixture.stdout),
          truncated: false
        }
      }
    }
    const cases = []
    try {
      await mkdir(ROOT, { recursive: true })
      await sails.models.app.updateOne({ id: app.id }).set({
        status: 'running',
        containerName: 'sounding-helm-terminal-prompt-fixture'
      })
      await page.raw.route('**/helm/completions*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            available: true,
            version: 1,
            models: [],
            helpers: [],
            config: []
          })
        })
      )
      await page.raw.route('**/helm/history?**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ entries: historyEntries })
        })
      )
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => url.pathname === '/')
      const helmPath = `/projects/${current.projects.deploymentTarget.slug}/environments/${environment.slug}/helm?appSlug=${app.slug}`
      for (const [device, width, height] of [
        ['desktop', 1440, 900],
        ['mobile', 390, 844]
      ]) {
        for (const theme of ['light', 'dark']) {
          historyEntries = []
          await page.resize(width, height)
          if (theme === 'light') await page.inLightMode()
          else await page.inDarkMode()
          await page.goto(helmPath)
          const commandMode = page.raw.getByRole('button', {
            name: 'Command mode',
            exact: true
          })
          const javascriptMode = page.raw.getByRole('button', {
            name: 'JavaScript mode',
            exact: true
          })
          const input = page.raw.locator('#helm-command-input')
          // One untimed warmup, then real browser clicks and input events.
          await commandMode.click()
          await expect(input).toBeVisible()
          const revealSamples = []
          const inputSamples = []
          for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
            await javascriptMode.click()
            await markEventToFrame(commandMode, 'click')
            await commandMode.click()
            revealSamples.push(
              await page.raw.evaluate(() => window.__helmPromptFrame)
            )
            await input.fill('')
            await markEventToFrame(input, 'input')
            await input.press('x')
            inputSamples.push(
              await page.raw.evaluate(() => window.__helmPromptFrame)
            )
            await expect(input).toHaveValue('x')
          }
          await input.fill(SOURCE)
          await expect(
            page.raw.locator('[data-test="helm-command-status"]')
          ).toHaveText('Ready')
          await expect(
            page.raw.getByRole('region', {
              name: 'Command output',
              exact: true
            })
          ).toHaveText('Command output will appear here.')
          // Keep the real native text caret for this focused capture; the
          // ordinary screenshots below use Playwright's stable hidden caret.
          // No cursor overlay, animation, or timer is introduced by the UI.
          await input.focus()
          await input.press('End')
          await expect(input).toBeFocused()
          const caret = await input.evaluate((element) => {
            const style = getComputedStyle(element)
            return {
              color: style.caretColor,
              textColor: style.color,
              selectionStart: element.selectionStart,
              selectionEnd: element.selectionEnd
            }
          })
          expect(caret.color).toBe(caret.textColor)
          expect(caret.color === 'rgba(0, 0, 0, 0)').toBe(false)
          expect(caret.selectionStart).toBe(SOURCE.length)
          expect(caret.selectionEnd).toBe(SOURCE.length)
          await page.raw.mouse.move(1, 1)
          await page.screenshot(
            path.join(ROOT, `${device}-${theme}-focused-native-caret.png`),
            { animations: 'disabled', caret: 'initial' }
          )
          // Capture the resting state on both revisions without changing focus.
          await page.raw.mouse.move(1, 1)
          await page.screenshot(
            path.join(ROOT, `${device}-${theme}-idle.png`),
            {
              animations: 'disabled'
            }
          )
          const before = executions
          // This works on both revisions and deliberately avoids any new key
          // handling or icon-only button text introduced by the refinement.
          await page.click('@helm-command-run')
          const dialog = page.raw.getByRole('alertdialog', {
            name: 'Arm production command?'
          })
          await expect(dialog).toBeVisible()
          await expect(dialog.locator('..')).toHaveCSS('opacity', '1')
          await page.raw.mouse.move(1, 1)
          await page.screenshot(
            path.join(ROOT, `${device}-${theme}-warning.png`),
            {
              animations: 'disabled'
            }
          )
          expect(executions).toBe(before)
          await page.click('@helm-arm-writes')
          await expect(dialog).toBeHidden()
          expect(executions).toBe(before)
          await page.click('@helm-command-run')
          await expect(
            page.raw.locator('[data-test="helm-command-status"]')
          ).toHaveText('Completed')
          const output = page.raw.getByRole('region', {
            name: 'Command output',
            exact: true
          })
          await expect(output).toHaveText(OUTPUT)
          await expect(input).toHaveValue(SOURCE)
          expect(executions).toBe(before + 1)
          await expect(
            page.raw.locator('[data-test="helm-command-console"]')
          ).toContainText('exit 0')
          const layout = await page.raw.evaluate(() => {
            const console = document
              .querySelector('[data-test="helm-command-console"]')
              .getBoundingClientRect()
            const input = document
              .querySelector('#helm-command-input')
              .getBoundingClientRect()
            const output = document
              .querySelector('[aria-label="Command output"]')
              .getBoundingClientRect()
            const submit = document
              .querySelector('[data-test="helm-command-run"]')
              .getBoundingClientRect()
            return {
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
              documentWidth: document.documentElement.scrollWidth,
              consoleHeight: console.height,
              consoleBottom: console.bottom,
              inputWidth: input.width,
              inputHeight: input.height,
              outputTop: output.top,
              outputHeight: output.height,
              submitWidth: submit.width,
              submitHeight: submit.height
            }
          })
          expect(layout.documentWidth <= width).toBe(true)
          expect(layout.consoleBottom <= height + 1).toBe(true)
          await page.raw.mouse.move(1, 1)
          await page.screenshot(
            path.join(ROOT, `${device}-${theme}-completed.png`),
            {
              animations: 'disabled'
            }
          )

          // A second, multi-line result makes the output hierarchy reviewable.
          // This is a synthetic readiness summary produced by the exact Node
          // expression shown in the prompt, never an observed service status.
          await input.fill(SUMMARY_SOURCE)
          await page.click('@helm-command-run')
          await expect(dialog).toBeVisible()
          expect(executions).toBe(before + 1)
          await page.click('@helm-arm-writes')
          await expect(dialog).toBeHidden()
          expect(executions).toBe(before + 1)
          await page.click('@helm-command-run')
          await expect(
            page.raw.locator('[data-test="helm-command-status"]')
          ).toHaveText('Completed')
          await expect(output).toHaveText(SUMMARY_OUTPUT)
          await expect(input).toHaveValue(SUMMARY_SOURCE)
          expect(executions).toBe(before + 2)
          await page.raw.mouse.move(1, 1)
          await page.screenshot(
            path.join(ROOT, `${device}-${theme}-meaningful-output.png`),
            { animations: 'disabled' }
          )

          // Both versions preserve the previous output while the draft changes;
          // the current-only provenance behavior is asserted in helm.test.js.
          await input.fill(EDITED_SOURCE)
          await expect(output).toHaveText(SUMMARY_OUTPUT)
          expect(executions).toBe(before + 2)
          await page.raw.mouse.move(1, 1)
          await page.screenshot(
            path.join(ROOT, `${device}-${theme}-edited-draft.png`),
            { animations: 'disabled' }
          )
          await page.raw
            .getByRole('button', { name: 'Command history', exact: true })
            .click()
          const history = page.raw.locator(
            '[aria-label="Command history entries"]'
          )
          const restore = history
            .getByRole('button')
            .filter({ hasText: SOURCE })
          await expect(restore).toBeVisible()
          await page.raw.mouse.move(1, 1)
          await page.screenshot(
            path.join(ROOT, `${device}-${theme}-history-open.png`),
            { animations: 'disabled' }
          )
          await restore.click()
          await expect(input).toHaveValue(SOURCE)
          await expect(input).toBeFocused()
          await expect(output).toHaveText(SUMMARY_OUTPUT)
          expect(executions).toBe(before + 2)
          await page.raw.mouse.move(1, 1)
          await page.screenshot(
            path.join(ROOT, `${device}-${theme}-history-restored.png`),
            { animations: 'disabled' }
          )
          cases.push({
            device,
            theme,
            layout,
            modeClickToSecondAnimationFrame: summarize(revealSamples),
            inputEventToSecondAnimationFrame: summarize(inputSamples)
          })
        }
      }
      expect(executions).toBe(8)
      expect(page).toHaveNoSmoke()
      const report = {
        variant: VARIANT,
        sourceRevision:
          process.env.HELM_PROMPT_SOURCE_REVISION || 'working-tree',
        fixture: {
          commands: FIXTURES,
          editedDraft: EDITED_SOURCE,
          stderr: '',
          exitCode: 0,
          durationMs: 24,
          transport:
            'real browser fetch/NDJSON and server actions; container runner replaced with deterministic fixture',
          meaning:
            'Arithmetic and multi-line readiness summary are synthetic; no container execution or actual service health is observed. History is deterministic source/status metadata only.',
          productionTarget: true
        },
        methodology: {
          samplesPerCase: SAMPLE_COUNT,
          warmup: 'one untimed command-mode reveal per viewport/theme',
          measurements:
            'browser performance.now() from actual click/input event to the second requestAnimationFrame',
          limits:
            'Frame-scheduled, tiny synthetic samples on a shared CI runner; not command-runtime, deployment, startup, or statistically meaningful performance evidence. No speedup claim or timing pass/fail threshold.'
        },
        browser: {
          userAgent: await page.raw.evaluate(() => navigator.userAgent),
          version: page.raw.context().browser().version()
        },
        cases
      }
      await writeFile(
        path.join(ROOT, 'metrics.json'),
        JSON.stringify(report, null, 2) + '\n'
      )
      console.log(
        JSON.stringify({
          helmPromptVariant: VARIANT,
          cases: cases.length,
          executions
        })
      )
    } finally {
      sails.helpers.helm.executeCommandInContainer = originalRunner
    }
  }
)
