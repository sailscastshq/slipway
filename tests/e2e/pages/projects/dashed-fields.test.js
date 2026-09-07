const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'creation fields retain dashed styling and usable widths beside selects',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'dashed-fields', name: 'Dashed fields' }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const screenshots = path.resolve('.github/screenshots/dashed-fields')
    fs.mkdirSync(screenshots, { recursive: true })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/environments/production?services=1&apps=1`
    )
    await page.raw
      .getByRole('button', { name: '+ Add service', exact: true })
      .click()
    const name = page.raw.getByRole('textbox', {
      name: 'Service name',
      exact: true
    })
    const type = page.raw.getByRole('combobox', {
      name: 'Service type',
      exact: true
    })
    const version = page.raw.getByRole('combobox', {
      name: 'Service version',
      exact: true
    })
    await name.fill('main-db')
    await page.raw
      .getByRole('button', { name: '+ Add app', exact: true })
      .click()
    const appName = page.raw.getByPlaceholder('app name', { exact: true })
    await appName.fill('worker')
    for (const [width, scheme] of [
      [1440, 'dark'],
      [1440, 'light'],
      [390, 'dark']
    ]) {
      await page.raw.setViewportSize({ width, height: 1000 })
      await page.raw.emulateMedia({ colorScheme: scheme })
      for (const control of [name, type, version, appName]) {
        const style = await control.evaluate((element) => {
          const css = getComputedStyle(element)
          const box = element.getBoundingClientRect()
          return {
            dashed: css.borderBottomStyle,
            top: css.borderTopWidth,
            width: box.width,
            inside: box.left >= 0 && box.right <= window.innerWidth
          }
        })
        expect(style.dashed).toBe('dashed')
        expect(style.top).toBe('0px')
        expect(style.width > 100).toBe(true)
        expect(style.inside).toBe(true)
      }
      await name.scrollIntoViewIfNeeded()
      await page.screenshot(
        path.join(screenshots, `service-${width}-${scheme}.png`)
      )
    }
    await type.click()
    await page.raw.getByRole('option', { name: 'MySQL', exact: true }).click()
    await expect(type).toContainText('MySQL')
    expect(await name.inputValue()).toBe('main-db')
    await type.press('Space')
    expect(await type.getAttribute('aria-expanded')).toBe('true')
    await type.press('Escape')
    expect(await type.getAttribute('aria-expanded')).toBe('false')
    expect(page).toHaveNoSmoke()
  }
)
