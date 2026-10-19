const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

for (const browser of ['desktop', 'mobile']) {
  test(
    `Lookout Klean project filter keyboard and visual review on ${browser}`,
    {
      browser,
      world: {
        name: 'configured-slipway',
        context: { deploymentTarget: { slug: `lookout-select-${browser}` } }
      }
    },
    async ({ sails, world, page, login, expect }) => {
      const originalDisk = sails.helpers.lookout.getDiskSpace
      const originalHealth = sails.helpers.lookout.getObservabilityHealth
      const disk = async () => ({
        usedPercent: 68,
        used: '204 GB',
        total: '300 GB',
        available: '96 GB',
        mount: '/'
      })
      const health = async () => ({
        collector: {
          status: 'healthy',
          lastSuccessAt: Date.now(),
          rowCount: 12
        },
        retention: {
          status: 'healthy',
          lastSuccessAt: Date.now(),
          rowCount: 24
        }
      })
      disk.with = disk
      health.with = health
      sails.helpers.lookout.getDiskSpace = disk
      sails.helpers.lookout.getObservabilityHealth = health
      try {
        await sails.models.project
          .updateOne({ id: world.current.projects.deploymentTarget.id })
          .set({ name: `Alpha Project ${browser}` })
        await sails.models.app
          .updateOne({ id: world.current.apps.web.id })
          .set({
            name: `Alpha Web ${browser}`,
            status: 'running',
            containerName: `fixture-alpha-${browser}`
          })
        const project = await world.create('project').with({
          name: `Beta Project ${browser}`,
          slug: `lookout-beta-${browser}`,
          team: world.current.teams.genesisTeam.id,
          createdBy: world.current.users.genesisUser.id
        })
        const environment = await world
          .create('environment')
          .with({ project: project.id, name: 'Production', slug: 'production' })
        await world.create('app').with({
          environment: environment.id,
          name: `Beta Web ${browser}`,
          slug: 'web',
          status: 'running',
          containerName: `fixture-beta-${browser}`
        })
        await login.withPassword('genesisUser', page, {
          password: world.current.auth.genesisUserPassword
        })
        await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
        await page.raw.setViewportSize({
          width: browser === 'mobile' ? 390 : 1440,
          height: browser === 'mobile' ? 844 : 1000
        })
        await page.goto('/lookout')
        const output = path.resolve('.tmp/screenshots/lookout-project-select')
        fs.mkdirSync(output, { recursive: true })
        for (const colorScheme of ['light', 'dark']) {
          await page.raw.emulateMedia({ colorScheme })
          const control = page.raw.getByRole('combobox', {
            name: 'Filter by project'
          })
          await expect(control).toBeVisible()
          await page.screenshot(
            path.join(output, `after-${browser}-${colorScheme}-closed.png`)
          )
          await control.click()
          await expect(
            page.raw.getByRole('option', {
              name: `Beta Project ${browser}`,
              exact: true
            })
          ).toBeVisible()
          // Floating UI positions the native top-layer popup asynchronously.
          // Assert anchoring before capturing the visual review fixture.
          await page.raw.waitForFunction(() => {
            const trigger = document
              .querySelector('[aria-label="Filter by project"]')
              ?.getBoundingClientRect()
            const popup = document
              .querySelector('[role="listbox"]')
              ?.getBoundingClientRect()
            return (
              trigger &&
              popup &&
              Math.abs(popup.x - trigger.x) < 8 &&
              popup.y >= trigger.y + trigger.height &&
              popup.y <= trigger.y + trigger.height + 12
            )
          })
          await page.screenshot(
            path.join(output, `after-${browser}-${colorScheme}-open.png`)
          )
          await control.press('Escape')
          await expect(control).toBeFocused()
          const border = await control.evaluate((element) => {
            const style = getComputedStyle(
              element.closest('[data-test="lookout-project-filter"]')
            )
            const trigger = getComputedStyle(element)
            return {
              bottom: style.borderBottomStyle,
              top: style.borderTopWidth,
              left: style.borderLeftWidth,
              right: style.borderRightWidth,
              triggerTop: trigger.borderTopWidth
            }
          })
          expect(border).toEqual({
            bottom: 'dashed',
            top: '0px',
            left: '0px',
            right: '0px',
            triggerTop: '0px'
          })
        }
        const control = page.raw.getByRole('combobox', {
          name: 'Filter by project'
        })
        await control.focus()
        await control.press('ArrowDown')
        await control.press('End')
        await control.press('Enter')
        await expect(control).toHaveText(`Beta Project ${browser}`)
        await expect(
          page.raw
            .locator('.max-w-6xl')
            .locator(`a[href="/projects/lookout-beta-${browser}"]`)
        ).toBeVisible()
        await expect(
          page.raw
            .locator('.max-w-6xl')
            .locator(`a[href="/projects/lookout-select-${browser}"]`)
        ).toHaveCount(0)
        const search = page.raw.getByPlaceholder('Filter containers...')
        await search.fill('no-matching-fixture')
        await expect(
          page.raw
            .locator('.max-w-6xl')
            .locator(`a[href="/projects/lookout-beta-${browser}"]`)
        ).toHaveCount(0)
        await search.fill('')
        await control.focus()
        await control.press('ArrowDown')
        await control.press('Home')
        await control.press('Enter')
        await expect(control).toHaveText('All projects')
        await expect(
          page.raw
            .locator('.max-w-6xl')
            .locator(`a[href="/projects/lookout-select-${browser}"]`)
        ).toBeVisible()
        await control.press('ArrowDown')
        await control.press('Escape')
        await expect(control).toHaveAttribute('aria-expanded', 'false')
        await expect(control).toBeFocused()
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true)
        expect(page).toHaveNoJavascriptErrors()
      } finally {
        sails.helpers.lookout.getDiskSpace = originalDisk
        sails.helpers.lookout.getObservabilityHealth = originalHealth
      }
    }
  )
}
