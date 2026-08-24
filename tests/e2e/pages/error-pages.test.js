const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

const ERROR_PAGES = {
  403: 'This area is not available',
  404: 'Nothing is here',
  419: 'Your session has expired',
  429: 'Give it a moment',
  500: 'Something went wrong',
  503: 'Slipway is temporarily unavailable'
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }
}

test(
  'every global error page is clear across viewports and color schemes',
  {
    browser: true,
    world: 'configured-slipway'
  },
  async ({ page, expect }) => {
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-388-error-pages/after'
    )
    const fallbackRoot = path.resolve(
      '.tmp/screenshots/issue-388-error-pages/fallback'
    )
    fs.mkdirSync(screenshotRoot, { recursive: true })
    fs.mkdirSync(fallbackRoot, { recursive: true })

    for (const [status, headline] of Object.entries(ERROR_PAGES)) {
      for (const [viewport, size] of Object.entries(VIEWPORTS)) {
        for (const colorScheme of ['light', 'dark']) {
          await page.resize(size.width, size.height)
          await page.raw.emulateMedia({ colorScheme })

          await page.goto(`/__sounding/errors/${status}?inertia=1`)
          await expect(page).toSee(headline)
          await expect(page).toSee('Slipway')
          expect(await hasDurableErrorLayout(page, status)).toBe(true)
          await expect(
            page.raw.locator('[data-slot="error-state"]')
          ).toHaveCount(1)
          await expect(
            page.raw.locator('[data-slot="error-state"]')
          ).not.toHaveAttribute('role', 'alert')
          expect(await hasVisibleSlippy(page)).toBe(true)
          if (viewport === 'mobile') {
            expect(await isSlippyAboveHeading(page)).toBe(true)
          }
          expect((await recoveryActionCount(page)) <= 2).toBe(true)
          expect(await hasAccessibleActions(page)).toBe(true)

          await page.screenshot(
            path.join(
              screenshotRoot,
              `${status}-${viewport}-${colorScheme}.png`
            ),
            { animations: 'disabled' }
          )
        }
      }

      await page.resize(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height)
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.goto(`/__sounding/errors/${status}`)
      await expect(page).toSee(headline)
      expect(await page.raw.locator('script').count()).toBe(0)
      expect(await hasDurableErrorLayout(page, status)).toBe(true)
      expect(await hasVisibleSlippy(page, '.slippy')).toBe(true)
      await page.screenshot(
        path.join(fallbackRoot, `${status}-desktop-light.png`),
        { animations: 'disabled' }
      )
    }

    expect(page).toHaveNoJavascriptErrors()
  }
)

async function hasDurableErrorLayout(page, status) {
  return page.raw.evaluate((expectedStatus) => {
    const surface = document.querySelector('[data-error-page]')
    const heading = document.querySelector('#error-heading')

    return (
      surface?.dataset.errorPage === String(expectedStatus) &&
      Boolean(heading?.textContent.trim()) &&
      document.documentElement.scrollWidth <= window.innerWidth
    )
  }, status)
}

async function recoveryActionCount(page) {
  return page.raw.locator('nav[aria-label="Recovery"] a').count()
}

async function hasVisibleSlippy(page, selector = '.slippy-loader') {
  return page.raw.locator(selector).evaluate((slippy) => {
    const bounds = slippy.getBoundingClientRect()
    const styles = window.getComputedStyle(slippy)

    return (
      styles.display !== 'none' &&
      styles.visibility !== 'hidden' &&
      bounds.width > 0 &&
      bounds.height > 0
    )
  })
}

async function isSlippyAboveHeading(page) {
  return page.raw.evaluate(() => {
    const slippy = document.querySelector('.slippy-loader')
    const heading = document.querySelector('#error-heading')

    return (
      slippy?.getBoundingClientRect().bottom <
      heading?.getBoundingClientRect().top
    )
  })
}

async function hasAccessibleActions(page) {
  const sizes = await page.raw
    .locator('nav[aria-label="Recovery"] a')
    .evaluateAll((actions) => {
      return actions.map((action) => action.getBoundingClientRect().height)
    })

  return sizes.length > 0 && sizes.every((height) => height >= 44)
}
