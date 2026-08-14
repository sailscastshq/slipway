const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'Klean Tooltip is visible to pointer and keyboard users without stealing focus',
  {
    browser: true,
    world: 'configured-slipway'
  },
  async ({ page, expect, world }) => {
    const screenshotRoot = path.resolve('.tmp/screenshots/issue-436-tooltip')
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })

    await page.goto('/login')
    const csrf = await page.raw.evaluate(
      () => window.__SLIPWAY_CSRF_TOKEN__ || ''
    )
    const loginResponse = await page.raw.request.post('/login', {
      headers: { 'x-csrf-token': csrf },
      form: {
        email: world.current.users.genesisUser.email,
        password: world.current.auth.genesisUserPassword
      }
    })
    if (!loginResponse.ok()) {
      throw new Error(
        `Browser session setup failed (${loginResponse.status()}): ${await loginResponse.text()}`
      )
    }
    await page.goto('/bosun')

    const trigger = page.raw.locator('[data-test="bosun-version"]')
    await trigger.focus()

    const tooltip = page.raw.getByRole('tooltip', {
      name: 'Slipway version'
    })
    await tooltip.waitFor({ state: 'visible' })

    expect(await trigger.getAttribute('aria-describedby')).toBe(
      await tooltip.getAttribute('id')
    )
    expect(
      await page.raw.evaluate(() => document.activeElement?.dataset.test)
    ).toBe('bosun-version')

    await page.key('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    expect(
      await page.raw.evaluate(() => document.activeElement?.dataset.test)
    ).toBe('bosun-version')

    await trigger.hover()
    await tooltip.waitFor({ state: 'visible' })
    await expectInvertedTooltip(tooltip, expect, 'dark')
    await page.screenshot(path.join(screenshotRoot, 'tooltip-light.png'), {
      animations: 'disabled'
    })

    await page.key('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw.mouse.move(0, 0)
    await trigger.hover()
    await tooltip.waitFor({ state: 'visible' })
    await expectInvertedTooltip(tooltip, expect, 'light')
    await page.screenshot(path.join(screenshotRoot, 'tooltip-dark.png'), {
      animations: 'disabled'
    })

    expect(page).toHaveNoJavascriptErrors()
  }
)

async function expectInvertedTooltip(tooltip, expect, surface) {
  const colors = await tooltip.evaluate((element) => {
    const tooltipStyle = getComputedStyle(element)
    const arrowStyle = getComputedStyle(
      element.querySelector('[data-slot="tooltip-arrow"]')
    )
    return {
      background: tooltipStyle.backgroundColor,
      foreground: tooltipStyle.color,
      arrow: arrowStyle.backgroundColor
    }
  })
  const background = rgbChannels(colors.background)
  const foreground = rgbChannels(colors.foreground)

  if (surface === 'dark') {
    expect(Math.max(...background) < 45).toBe(true)
    expect(Math.min(...foreground) > 220).toBe(true)
  } else {
    expect(Math.min(...background) > 220).toBe(true)
    expect(Math.max(...foreground) < 45).toBe(true)
  }
  expect(colors.arrow).toBe(colors.background)
}

function rgbChannels(value) {
  return value
    .match(/\d+(?:\.\d+)?/g)
    .slice(0, 3)
    .map(Number)
}
