const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'Bearing shows public feedback and updates without configuration redaction artifacts',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-redaction-browser',
          name: 'flossafrica'
        }
      }
    }
  },
  async ({ sails, world, page, login, expect }) => {
    const { projects, environments, apps, users, auth } = world.current
    const app = apps.web
    const dashboardProjects = [projects.deploymentTarget]
    for (const name of ['sailsconf', 'sailscasts']) {
      dashboardProjects.push(
        await sails.models.project
          .create({ name, team: projects.deploymentTarget.team })
          .fetch()
      )
    }
    const environmentValues = {
      BASE_URL: 'https://flossafrica.com',
      R2_BUCKET: 'flossafrica',
      S3_BUCKET_NAME: 'sailsconf',
      SPACES_BUCKET: 'sailscasts',
      sails_environment: 'production',
      R2_PUBLIC_URL: 'https://files.example.test',
      API_TOKEN: 'bearing-credential-canary-748'
    }
    const envVarMetadata =
      await sails.helpers.configuration.normalizeEnvVarMetadata.with({
        values: environmentValues,
        recordChanges: false
      })
    await sails.models.environment
      .updateOne({ id: environments.production.id })
      .set({ envVars: environmentValues, envVarMetadata })
    sails.hooks.secrets.remember(
      await sails.models.environment
        .findOne({ id: environments.production.id })
        .decrypt()
    )
    await sails.models.app.updateOne({ id: app.id }).set({
      bearingEnabled: true,
      secureEnvVars: { BRAND: 'flossafrica', OWNER: 'kelvin@example.test' }
    })
    sails.hooks.secrets.remember(
      await sails.models.app.findOne({ id: app.id }).decrypt()
    )
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'bearing-redaction-browser',
        app: app.id,
        createdBy: users.genesisUser.id
      })
      .fetch()
    const title = 'Support flossafrica'
    const details = 'Help flossafrica grow. Contact kelvin@example.test.'
    const feedback = await sails.models.bearingfeedback
      .create({ title, details, app: app.id, space: space.id })
      .fetch()
    const update = await sails.models.bearingupdate
      .create({
        title,
        slug: 'support-flossafrica',
        excerpt: details,
        body: '## Support flossafrica\n\n' + details,
        status: 'published',
        publishedAt: Date.now(),
        author: users.genesisUser.id,
        app: app.id,
        space: space.id
      })
      .fetch()
    const privatePath = `/_slipway/bearing/host/${projects.deploymentTarget.slug}/${environments.production.slug}/${app.slug}`
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
    const screenshots = path.resolve('.tmp/screenshots/issue-746-redaction')
    fs.mkdirSync(screenshots, { recursive: true })
    await page.resize(1440, 1000)
    await page.goto(`${privatePath}/feedback/${feedback.publicId}`)
    await expect(
      page.raw.getByRole('link', { name: title, exact: true })
    ).toBeVisible()
    await expect(page.raw.getByText(details, { exact: true })).toBeVisible()
    await expect(
      page.raw.getByText('[REDACTED]', { exact: false })
    ).toHaveCount(0)
    await page.screenshot(path.join(screenshots, 'public-feedback.png'), {
      fullPage: true
    })
    await page.resize(390, 844)
    await page.goto(`${privatePath}/feedback/${feedback.publicId}?embedded=1`)
    await expect(
      page.raw.getByRole('link', { name: title, exact: true })
    ).toBeVisible()
    await expect(page.raw.getByText(details, { exact: true })).toBeVisible()
    await page.screenshot(path.join(screenshots, 'embedded-feedback.png'), {
      fullPage: true
    })
    await page.resize(1440, 1000)
    await page.goto(`${privatePath}/updates/p/${update.slug}`)
    await expect(
      page.raw.getByRole('heading', { name: title, exact: true }).first()
    ).toBeVisible()
    await expect(
      page.raw.getByText(details, { exact: true }).last()
    ).toBeVisible()
    await page.screenshot(path.join(screenshots, 'public-update.png'), {
      fullPage: true
    })
    await login.withPassword('genesisUser', page, {
      password: auth.genesisUserPassword
    })
    await expect(page.raw).toHaveURL(new RegExp('/$'))
    for (const project of dashboardProjects) {
      await expect(
        page.raw.getByRole('link', { name: project.name, exact: true }).first()
      ).toBeVisible()
    }
    await expect(
      page.raw.getByText('[REDACTED]', { exact: false })
    ).toHaveCount(0)
    await page.screenshot(path.join(screenshots, 'dashboard-projects.png'), {
      fullPage: true
    })
    await page.goto(
      `/projects/${projects.deploymentTarget.slug}/environments/${environments.production.slug}/apps/${app.slug}/bearing`
    )
    await expect(
      page.raw.getByRole('link', { name: title, exact: true })
    ).toBeVisible()
    await page.screenshot(path.join(screenshots, 'manager-feedback.png'), {
      fullPage: true
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)
