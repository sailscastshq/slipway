const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test(
  'Trials prototype exposes truthful lifecycle states, check review and keyboard navigation',
  {
    browser: true
  },
  async ({ page, expect }) => {
    const screenshots = path.resolve('.tmp/screenshots/trials')
    fs.mkdirSync(screenshots, { recursive: true })
    await page.raw.goto(
      pathToFileURL(path.resolve('docs/trials/prototype.html')).href
    )
    await page.resize(1440, 1000)
    await expect(
      page.raw.getByText('INTERACTIVE DESIGN PROTOTYPE')
    ).toBeVisible()
    await expect(page.raw.locator('#status')).toHaveText('Passed')
    await page.screenshot(path.join(screenshots, 'passed-light.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    for (const [state, label] of [
      ['queued', 'Queued'],
      ['preparing', 'Preparing'],
      ['running', 'Running'],
      ['failed', 'Failed'],
      ['timed-out', 'Timed Out'],
      ['interrupted', 'Interrupted'],
      ['cancelled', 'Cancelled'],
      ['no-tests', 'No tests configured']
    ]) {
      await page.raw.getByLabel('Preview state').selectOption(state)
      await expect(page.raw.locator('#status')).toHaveText(label)
      await expect(page.raw.locator('#deploy')).toHaveText('Blocked')
    }
    await page.raw.getByLabel('Preview state').selectOption('interrupted')
    await expect(page.raw.locator('#summary')).toContainText(
      'Completion is unknown'
    )
    await page.raw.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.raw.locator('#status')).toHaveText('Queued')
    await expect(page.raw.locator('#attempt')).toHaveText('Attempt 2')
    await page.raw.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.raw.locator('#summary')).toContainText(
      'confirm process termination'
    )
    await expect(page.raw.locator('#status')).toHaveText('Cancelled')
    await page.raw.getByRole('button', { name: 'Review checks' }).click()
    await expect(
      page.raw.getByRole('tab', { name: 'Configuration' })
    ).toHaveAttribute('aria-selected', 'true')
    await expect(page.raw.getByLabel('Lint · suggested')).toBeFocused()
    await page.raw
      .getByRole('button', { name: 'Save prototype choices' })
      .click()
    await expect(page.raw.locator('#toast')).toHaveText(
      'Prototype choices updated. No configuration was saved or executed.'
    )
    await expect(page.raw.locator('#toast')).toBeHidden({ timeout: 6000 })
    await page.raw.getByRole('tab', { name: 'Configuration' }).focus()
    await page.raw.keyboard.press('ArrowLeft')
    await expect(
      page.raw.getByRole('tab', { name: 'Runs', exact: true })
    ).toHaveAttribute('aria-selected', 'true')
    await page.raw.getByRole('button', { name: 'Switch to dark theme' }).click()
    await page.raw.getByLabel('Preview state').selectOption('running')
    await page.screenshot(path.join(screenshots, 'running-dark.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.resize(390, 844)
    await page.raw.emulateMedia({ reducedMotion: 'reduce' })
    await page.raw.getByLabel('Preview state').selectOption('interrupted')
    expect(
      await page.raw.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.screenshot(path.join(screenshots, 'interrupted-mobile.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.getByRole('button', { name: 'Review checks' }).click()
    expect(
      await page.raw.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.screenshot(path.join(screenshots, 'configuration-mobile.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)
