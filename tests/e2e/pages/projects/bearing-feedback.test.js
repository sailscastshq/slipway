const { test } = require('sounding')

test(
  'Bearing feedback opens in public and admin views and supports confirmed deletion',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'feedback-management',
          name: 'Feedback Management'
        }
      }
    }
  },
  async ({ sails, world, page, login, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ bearingEnabled: true })
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'feedback-detail-browser',
        app: app.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()
    const details =
      'First line\nSecond line\nThird line\nFourth line\nThe final detail must be readable.'
    const feedback = await sails.models.bearingfeedback
      .create({
        title: 'Open this complete feedback',
        details,
        app: app.id,
        space: space.id
      })
      .fetch()
    const privatePath = `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}`
    await page.raw.route('**/bearing/**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/bearing/')) {
        url.pathname = `${privatePath}${url.pathname.slice('/bearing'.length)}`
        await route.continue({ url: url.toString() })
      } else await route.continue()
    })
    await page.raw.route('**/_slipway/bearing/_assets/**', async (route) => {
      const url = new URL(route.request().url())
      url.pathname = url.pathname.replace('/_slipway/bearing/_assets', '')
      await route.continue({ url: url.toString() })
    })
    await page.goto(`${privatePath}/feedback?embedded=1`)
    await page.raw
      .getByRole('link', { name: feedback.title, exact: true })
      .click()
    await expect(page.raw).toHaveURL(
      new RegExp(`${feedback.publicId}\\?embedded=1$`)
    )
    const publicDetails = page.raw
      .locator(`#bearing-feedback-${feedback.publicId} p`)
      .filter({ hasText: 'The final detail' })
    await expect(publicDetails).not.toHaveClass(/line-clamp-2/)
    await expect(publicDetails).toHaveText(details)

    const adminPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await expect(page.raw).toHaveURL(new RegExp('/$'))
    await page.goto(`${adminPath}?view=feedback`)
    await page.raw
      .getByRole('link', { name: feedback.title, exact: true })
      .click()
    await expect(
      page.raw.getByRole('link', { name: 'Back to feedback' })
    ).toBeVisible()
    const adminDetails = page.raw
      .locator('article p')
      .filter({ hasText: 'The final detail' })
    await expect(adminDetails).not.toHaveClass(/line-clamp-2/)
    await expect(adminDetails).toHaveText(details)
    await page.raw.reload()
    await expect(
      page.raw.getByRole('link', { name: 'Back to feedback' })
    ).toBeVisible()
    await page.raw
      .getByRole('button', { name: `Delete ${feedback.title}`, exact: true })
      .click()
    await page.raw.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await sails.models.bearingfeedback.count({ id: feedback.id })).toBe(
      1
    )
    await page.raw
      .getByRole('button', { name: `Delete ${feedback.title}`, exact: true })
      .click()
    await page.raw
      .getByRole('button', { name: 'Delete feedback', exact: true })
      .click()
    await expect(
      page.raw.getByText('No feedback yet.', { exact: true })
    ).toBeVisible()
    expect(await sails.models.bearingfeedback.count({ id: feedback.id })).toBe(
      0
    )
  }
)
