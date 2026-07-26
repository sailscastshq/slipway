const { test } = require('sounding')

test(
  'project cleanup makes retention explicit in light and dark mode',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'cleanup-retention-ui',
          name: 'Cleanup retention'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/settings`
    )
    await page.raw
      .getByRole('button', { name: 'Delete project', exact: true })
      .click()

    await expect(page).toSee(
      'Recovery data is retained unless you choose to purge it.'
    )
    await expect(page).toSee('Also permanently delete retained data')
    await expect(page).toSee(
      'Purges service volumes, backups, source, and Docker images.'
    )

    const modal = page.raw.locator('[data-test="confirm-modal"]')
    const purgeData = page.raw.getByRole('checkbox', {
      name: 'Also permanently delete retained data'
    })
    const deleteButton = modal.getByRole('button', {
      name: 'Delete project',
      exact: true
    })

    expect(await purgeData.isChecked()).toBe(false)
    expect(await modal.getAttribute('class')).toContain('dark:bg-gray-900')
    expect(await deleteButton.getAttribute('class')).toContain('bg-red-600')
    await page.wait(250)
    await page.screenshot('.tmp/cleanup-retention-light.png', {
      fullPage: true
    })

    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot('.tmp/cleanup-retention-dark.png', {
      fullPage: true
    })
    await page.raw.emulateMedia({ colorScheme: 'light' })

    expect(page).toHaveNoSmoke()
  }
)
