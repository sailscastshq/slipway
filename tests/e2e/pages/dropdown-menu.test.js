const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const capturePhase = process.env.MENU_SCREENSHOT_PHASE || 'after'
const screenshotRoot = path.resolve(
  `.tmp/screenshots/issue-340-dropdown-menu/${capturePhase}`
)

test(
  'project actions preserve their visual contract with Klean Menu',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'klean-menu-contract',
          name: 'Klean menu contract'
        }
      }
    }
  },
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

    const project = world.current.projects.deploymentTarget
    const trigger = page.raw.locator(
      `[data-test="project-actions-${project.slug}"]`
    )

    await trigger.click()
    const menu = page.raw.getByText('Copy slug', { exact: true }).locator('..')
    await expect(menu).toBeVisible()
    await page.wait(100)

    await page.screenshot(
      path.join(screenshotRoot, 'project-actions-desktop-light.png'),
      { animations: 'disabled' }
    )

    await page.inDarkMode()
    await page.wait(100)
    await page.screenshot(
      path.join(screenshotRoot, 'project-actions-desktop-dark.png'),
      { animations: 'disabled' }
    )

    if (capturePhase === 'after') {
      await expect(menu).toHaveAttribute('data-slot', 'menu')
      await expect(menu).toHaveAttribute('role', 'menu')
      await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')

      await page.key('c')
      expect(
        await page.raw.evaluate(() =>
          document.activeElement?.textContent.trim()
        )
      ).toBe('Copy slug')

      await page.key('Escape')
      await expect(menu).toBeHidden()
      expect(
        await page.raw.evaluate(() => document.activeElement?.dataset.test)
      ).toBe(`project-actions-${project.slug}`)

      const teamTrigger = page.raw.locator(
        '[data-test="desktop-team-selector"]'
      )
      await teamTrigger.click()
      const teamMenu = page.raw.locator('#desktop-team-menu')
      await expect(teamMenu).toBeVisible()
      await expect(teamMenu).toHaveAttribute('data-slot', 'menu')
      await page.key('Escape')
      await expect(teamMenu).toBeHidden()
      expect(
        await page.raw.evaluate(() => document.activeElement?.dataset.test)
      ).toBe('desktop-team-selector')

      const userTrigger = page.raw.locator(
        '[data-test="desktop-user-menu-button"]'
      )
      await userTrigger.click()
      const userMenu = page.raw.locator('#desktop-user-menu')
      await expect(userMenu).toBeVisible()
      await expect(userMenu).toHaveAttribute('data-slot', 'menu')
      await page.key('Escape')
      await expect(userMenu).toBeHidden()
    }

    expect(page).toHaveNoSmoke()
  }
)
