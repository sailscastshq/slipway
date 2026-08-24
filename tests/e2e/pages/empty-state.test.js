const { test } = require('sounding')

test(
  'Klean Empty State preserves distinct first-use, filtered, and operational reasons',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'klean-empty-state',
          name: 'Klean Empty State'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.goto('/')

    const projectSearch = page.raw.getByPlaceholder('Search projects...')
    await projectSearch.fill('no-such-project')
    const filteredProjects = page.raw.getByRole('region', {
      name: 'No projects found matching "no-such-project"'
    })
    await expect(filteredProjects).toHaveAttribute('data-slot', 'empty-state')
    await filteredProjects.getByRole('button', { name: 'Clear search' }).click()
    await expect(projectSearch).toBeFocused()
    await expect(page.raw.getByText('Klean Empty State')).toBeVisible()

    const otherTeam = await world.create('team').with({
      name: 'A different team',
      slug: 'a-different-team',
      owner: current.users.genesisUser.id
    })
    await sails.models.project
      .updateOne({ id: current.projects.deploymentTarget.id })
      .set({ team: otherTeam.id })
    await page.reload()

    const firstProject = page.raw.getByRole('region', {
      name: 'No projects yet'
    })
    await expect(firstProject).toHaveAttribute('data-slot', 'empty-state')
    await expect(firstProject.getByRole('heading', { level: 1 })).toHaveText(
      'No projects yet'
    )
    await expect(
      firstProject.getByRole('link', { name: 'Create Project' })
    ).toHaveAttribute('href', '/projects/new')

    await page.goto('/settings/audit-log?q=no-such-event')
    const auditEmpty = page.raw.locator('[data-test="audit-empty"]')
    await expect(auditEmpty).toHaveAttribute('data-slot', 'empty-state')
    await expect(
      auditEmpty.getByRole('heading', { name: 'No matching events' })
    ).toBeVisible()
    await auditEmpty.getByRole('button', { name: 'Clear filters' }).click()
    await page.raw.waitForURL((url) => !url.searchParams.has('q'))
    await expect(page.raw.getByLabel('Search audit events')).toBeFocused()

    expect(page).toHaveNoSmoke()
  }
)
