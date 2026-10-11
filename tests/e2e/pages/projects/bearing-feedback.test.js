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
        allowAnonymousParticipation: true,
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
    for (let index = 0; index < 12; index++) {
      await sails.models.bearingfeedback.create({
        title: `Other request ${index}`,
        details: 'Another request on the board.',
        app: app.id,
        space: space.id
      })
    }
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
    await page.goto(`/bearing/feedback?embedded=1`)
    await page.resize(1280, 600)
    await page.raw
      .getByRole('link', { name: feedback.title, exact: true })
      .scrollIntoViewIfNeeded()
    const boardScroll = await page.raw.evaluate(() => window.scrollY)
    await page.raw
      .getByRole('link', { name: feedback.title, exact: true })
      .click()
    await expect(page.raw).toHaveURL(
      new RegExp(`${feedback.publicId}\\?embedded=1$`)
    )
    await expect(
      page.raw.getByRole('heading', { level: 1, name: feedback.title })
    ).toBeVisible()
    await expect(page.raw.locator('#bearing-feedback-title')).toHaveCount(0)
    await expect(page.raw.getByLabel('Search feedback')).toHaveCount(0)
    await expect(page.raw.locator('.bearing-feedback-card')).toHaveCount(1)
    const vote = page.raw.getByRole('button', {
      name: `Vote for ${feedback.title}. 0 votes`,
      exact: true
    })
    await vote.click()
    await expect(
      page.raw.getByRole('button', {
        name: `Remove vote from ${feedback.title}. 1 votes`,
        exact: true
      })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.raw).toHaveURL(
      new RegExp(`${feedback.publicId}\\?embedded=1$`)
    )
    await page.raw.reload()
    await expect(
      page.raw.getByRole('heading', { level: 1, name: feedback.title })
    ).toBeVisible()
    await page.raw
      .getByRole('link', { name: 'All feedback', exact: true })
      .click()
    await expect(page.raw.getByLabel('Search feedback')).toHaveCount(1)
    expect(await page.raw.evaluate(() => window.scrollY)).toBe(boardScroll)
    await page.raw.getByLabel('Search feedback').fill('complete')
    await expect(page.raw).toHaveURL(/q=complete/)
    await page.raw
      .getByRole('link', { name: feedback.title, exact: true })
      .click()
    await page.raw
      .getByRole('link', { name: 'All feedback', exact: true })
      .click()
    await expect(page.raw.getByLabel('Search feedback')).toHaveValue('complete')
    await page.raw
      .getByRole('link', { name: feedback.title, exact: true })
      .click()
    const screenshotRoot = require('node:path').resolve(
      '.tmp/screenshots/issue-754'
    )
    require('node:fs').mkdirSync(screenshotRoot, { recursive: true })
    for (const [name, width, height] of [
      ['desktop', 1440, 1000],
      ['mobile', 390, 700]
    ]) {
      await page.resize(width, height)
      await page.screenshot(
        require('node:path').join(screenshotRoot, `${name}-detail.png`),
        { fullPage: true }
      )
    }
    await page.raw.goBack()
    await expect(page.raw.getByLabel('Search feedback')).toHaveValue('complete')
    await page.raw.goForward()
    await expect(
      page.raw.getByRole('heading', { level: 1, name: feedback.title })
    ).toBeVisible()
    const publicDetails = page.raw
      .locator(`#bearing-feedback-${feedback.publicId} p`)
      .filter({ hasText: 'The final detail' })
    await expect(publicDetails).not.toHaveClass(/line-clamp-2/)
    await expect(publicDetails).toHaveText(details)

    await sails.models.bearingfeedback.destroy({
      space: space.id,
      id: { '!=': feedback.id }
    })
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
