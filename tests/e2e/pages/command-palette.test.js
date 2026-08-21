const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const capturePhase = process.env.COMMAND_SCREENSHOT_PHASE || 'after'
const screenshotRoot = path.resolve(
  `.tmp/screenshots/issue-343-command/${capturePhase}`
)

test(
  'command palette preserves its visual and interaction contract with Klean Command',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto('/')
    await page.key('Control+k')

    const input = page.raw.locator(
      'input[placeholder="Type a command or search..."]'
    )
    await expect(input).toBeVisible()
    await page.raw.mouse.move(720, 463)
    await page.wait(100)
    await page.screenshot(
      path.join(screenshotRoot, 'command-palette-desktop-light.png'),
      { animations: 'disabled' }
    )

    await page.inDarkMode()
    await page.wait(100)
    await page.screenshot(
      path.join(screenshotRoot, 'command-palette-desktop-dark.png'),
      { animations: 'disabled' }
    )

    await page.key('Escape')
    await page.resize(390, 844)
    await page.inLightMode()
    await page.raw
      .locator('button:visible')
      .filter({
        has: page.raw.locator('svg[viewBox="-0.5 -0.5 16 16"]')
      })
      .first()
      .click()
    await page.raw
      .locator('button[popovertarget="mobile-user-menu"]:visible')
      .click()
    await page.raw
      .locator('#mobile-user-menu')
      .getByText('Search', { exact: true })
      .click()
    await expect(input).toBeVisible()
    await page.wait(100)
    await page.screenshot(
      path.join(screenshotRoot, 'command-palette-mobile-light.png'),
      { animations: 'disabled' }
    )

    await page.inDarkMode()
    await page.wait(100)
    await page.screenshot(
      path.join(screenshotRoot, 'command-palette-mobile-dark.png'),
      { animations: 'disabled' }
    )

    if (capturePhase === 'after') {
      await expect(input).toHaveAttribute('role', 'combobox')
      await expect(input).toHaveAttribute('aria-controls')
      await expect(input).toHaveAttribute('aria-activedescendant')

      await input.fill('Lookout')
      await expect(
        page.raw.getByRole('option', { name: /Go to Lookout/ })
      ).toBeVisible()
      await page.key('Enter')
      await expect(
        page.raw.getByText('Commands', { exact: true })
      ).toBeVisible()
      await page.key('Backspace')
      await expect(page.raw.getByText('Commands', { exact: true })).toBeHidden()

      await input.fill('nothing-can-match-this')
      await expect(
        page.raw.getByText('No results for "nothing-can-match-this"')
      ).toBeVisible()

      await input.fill('')
      await page.key('End')
      const lastActiveId = await input.getAttribute('aria-activedescendant')
      await expect(page.raw.locator(`#${lastActiveId}`)).toBeInViewport()
      await page.key('Home')
      await page.key('Escape')
      await expect(input).toBeHidden()

      await page.resize(1440, 900)
      const userMenuTrigger = page.raw.locator(
        '[data-test="desktop-user-menu-button"]'
      )
      await userMenuTrigger.focus()
      await page.key('Control+k')
      await expect(input).toBeFocused()
      await page.raw.evaluate(() => {
        const commandInput = document.querySelector(
          'input[placeholder="Type a command or search..."]'
        )
        commandInput.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            keyCode: 229,
            bubbles: true,
            cancelable: true
          })
        )
      })
      await expect(input).toBeVisible()
      await page.key('Escape')
      await expect(userMenuTrigger).toBeFocused()
    }

    expect(page).toHaveNoSmoke()
  }
)
