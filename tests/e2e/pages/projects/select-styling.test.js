const path = require('node:path')
const { test } = require('sounding')

test(
  'compact database select renders as text and one caret without chrome',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'compact-database-select',
          name: 'Compact Database Select'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const serviceDefaults = {
      type: 'postgresql',
      version: '17',
      status: 'running',
      environment: current.environments.production.id,
      internalPort: 5432,
      database: 'app',
      username: 'slipway',
      password: 'secret'
    }
    const database = await world.create('service').with({
      ...serviceDefaults,
      name: 'db',
      internalHost: 'db'
    })
    await world.create('service').with({
      ...serviceDefaults,
      name: 'analytics-db',
      internalHost: 'analytics-db'
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

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await expect(
      page.raw.getByRole('link', {
        name: current.projects.deploymentTarget.name,
        exact: true
      })
    ).toBeVisible()
    await page.resize(1440, 900)
    await page.inLightMode()
    await page.raw.addInitScript(() => {
      const original = Element.prototype.getBoundingClientRect
      window.__closedSelectMeasurements = 0
      Element.prototype.getBoundingClientRect = function (...args) {
        if (
          this.matches(
            '[data-test="dock-database-selector"] [data-slot="select-trigger"]'
          ) &&
          this.getAttribute('aria-expanded') === 'false'
        ) {
          window.__closedSelectMeasurements++
        }
        return original.apply(this, args)
      }
    })
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/environments/production/dock/${database.id}`
    )

    const selector = page.raw.locator('[data-test="dock-database-selector"]')
    const trigger = selector.locator('[data-slot="select-trigger"]')
    const popup = selector.locator('[data-slot="select-content"]')
    // Do not run Playwright's visibility/actionability checks before counting:
    // those checks also call getBoundingClientRect on the closed trigger.
    await page.raw.waitForFunction(() =>
      document.querySelector(
        '[data-test="dock-database-selector"] [data-slot="select-trigger"]'
      )
    )
    await settleSelectLayout(page)
    expect(
      await page.raw.evaluate(() => window.__closedSelectMeasurements)
    ).toBe(0)
    await selector.waitFor()
    await selector.screenshot({
      path: path.resolve('.tmp/issue-509-select-after.png')
    })

    const chrome = await trigger.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        borderTopWidth: style.borderTopWidth,
        borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        borderRadius: style.borderRadius,
        hasVisibleShadow: style.boxShadow.includes('0.1)')
      }
    })

    expect(chrome).toMatchObject({
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderRadius: '0px',
      hasVisibleShadow: false
    })
    expect(
      await selector.locator('svg').filter({ visible: true }).count()
    ).toBe(1)

    await trigger.press('Space')
    expect(await trigger.getAttribute('aria-expanded')).toBe('true')
    await expectSelectPlacement(page, popup, expect, 'bottom')
    await trigger.press('Escape')
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    await expect(trigger).toBeFocused()

    await page.raw.evaluate(() => {
      window.__closedSelectMeasurements = 0
      const trigger = document.querySelector(
        '[data-test="dock-database-selector"] [data-slot="select-trigger"]'
      )
      trigger.style.width = '25vw'
      trigger.blur()
      trigger.focus()
    })
    await page.resize(1280, 900)
    await settleSelectLayout(page)
    expect(
      await page.raw.evaluate(() => window.__closedSelectMeasurements)
    ).toBe(0)
    await expect(trigger).toBeFocused()

    // Opening after a closed resize must use the new width. While open, both
    // trigger resizing and viewport repositioning must continue to work.
    await trigger.click()
    await expectSelectPlacement(page, popup, expect, 'bottom')
    await page.resize(1024, 900)
    await expectSelectPlacement(page, popup, expect, 'bottom')
    await trigger.press('Escape')
    await expect(trigger).toBeFocused()

    await selector.evaluate((element) => {
      Object.assign(element.style, {
        position: 'fixed',
        right: '8px',
        bottom: '8px'
      })
    })
    await trigger.press('ArrowUp')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expectSelectPlacement(page, popup, expect, 'top-start')
    const lastOption = await trigger.getAttribute('aria-activedescendant')
    expect(lastOption).toBeTruthy()
    await trigger.press('ArrowDown')
    expect(await trigger.getAttribute('aria-activedescendant')).not.toBe(
      lastOption
    )
    await trigger.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await expectSelectPlacement(page, popup, expect, 'top-start')
    await trigger.press('Tab')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).not.toBeFocused()
    expect(page).toHaveNoSmoke()
  }
)

async function settleSelectLayout(page) {
  await page.raw.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      })
  )
}

async function expectSelectPlacement(page, popup, expect, placement) {
  await popup.waitFor({ state: 'visible' })
  const id = await popup.getAttribute('id')
  await page.raw.waitForFunction(
    ({ id, placement }) => {
      const content = document.getElementById(id)
      const trigger = document.querySelector(`[popovertarget="${id}"]`)
      const anchor = trigger.getBoundingClientRect()
      const surface = content.getBoundingClientRect()
      const resolved = content.dataset.placement
      // The real header can require horizontal collision handling. Match the
      // reported alignment and Popover's 8px viewport shift padding.
      const alignedX = resolved.endsWith('-end')
        ? anchor.right - surface.width
        : anchor.left
      const expectedX = Math.min(
        Math.max(8, alignedX),
        window.innerWidth - surface.width - 8
      )
      const expectedY = placement.startsWith('top')
        ? anchor.top - 4 - surface.height
        : anchor.bottom + 4
      return (
        (placement.includes('-')
          ? resolved === placement
          : resolved.split('-')[0] === placement) &&
        Math.abs(parseFloat(content.style.minWidth) - anchor.width) < 1 &&
        surface.width >= anchor.width - 1 &&
        Math.abs(surface.left - expectedX) < 2 &&
        Math.abs(surface.top - expectedY) < 2
      )
    },
    { id, placement }
  )
  const insideViewport = await popup.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return (
      box.left >= 0 &&
      box.right <= window.innerWidth &&
      box.top >= 0 &&
      box.bottom <= window.innerHeight
    )
  })
  expect(insideViewport).toBe(true)
}
