const { test } = require('sounding')
const { INERTIA_HEADERS } = require('../../support/csrf-request')

test(
  'Bearing public content survives legacy encrypted configuration collisions in HTML and Inertia responses',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'bearing-redaction', name: 'flossafrica' }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const { projects, environments, apps, users } = world.current
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
      secureEnvVars: {
        BRAND: 'flossafrica',
        OWNER: 'kelvin@example.test',
        HOST: 'files.example.test'
      }
    })
    const persisted = await sails.models.app.findOne({ id: app.id }).decrypt()
    sails.hooks.secrets.remember(persisted)
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'bearing-redaction',
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
        body: 'Support flossafrica.\n\n![flossafrica](https://files.example.test/flossafrica.webp)',
        status: 'published',
        publishedAt: Date.now(),
        author: users.genesisUser.id,
        app: app.id,
        space: space.id
      })
      .fetch()
    const base = `/_slipway/bearing/host/${projects.deploymentTarget.slug}/${environments.production.slug}/${app.slug}`
    const client = request.withHeaders({
      'x-forwarded-host': 'flossafrica.com',
      'x-forwarded-proto': 'https'
    })
    for (const embedded of ['', '?embedded=1']) {
      const path = `${base}/feedback/${feedback.publicId}${embedded}`
      const page = await client.withHeaders(INERTIA_HEADERS).get(path)
      expect(page).toHaveStatus(200)
      expect(page.data.props.app.name).toBe('flossafrica')
      expect(page.data.props.app.homeUrl).toBe('https://flossafrica.com/')
      expect(page.data.props.app.publicUrl).toContain(
        'https://flossafrica.com/bearing/feedback/'
      )
      expect(page.data.props.realtime.subscribePath).toBe(`${base}/realtime`)
      expect(JSON.stringify(page.data).includes('[REDACTED]')).toBe(false)
      expect(page.data.props.feedback.data[0].title).toBe(title)
      expect(page.data.props.feedback.data[0].details).toBe(details)
      const document = await client
        .withHeaders({ accept: 'text/html' })
        .get(path)
      expect(document).toHaveStatus(200)
      expect(document.body.includes(title)).toBe(true)
      expect(document.body.includes(details)).toBe(true)
      expect(document.body.includes('Support [REDACTED]')).toBe(false)
      const article = await client
        .withHeaders(INERTIA_HEADERS)
        .get(`${base}/updates/p/${update.slug}${embedded}`)
      expect(article).toHaveStatus(200)
      expect(article.data.props.update.title).toBe(title)
      expect(article.data.props.update.body).toBe(update.body)
      expect(article.data.props.publicUrl).toBe(
        `https://flossafrica.com/bearing/updates/p/${update.slug}`
      )
    }
    const dashboard = await request
      .using('virtual')
      .as('genesisUser')
      .withHeaders(INERTIA_HEADERS)
      .get('/')
    expect(dashboard).toHaveStatus(200)
    for (const project of dashboardProjects) {
      const rendered = dashboard.data.props.projects.find(
        (entry) => entry.id === project.id
      )
      expect(rendered.name).toBe(project.name)
      expect(rendered.slug).toBe(project.slug)
      expect(
        (await sails.models.project.findOne({ id: project.id })).name
      ).toBe(project.name)
    }
    const stored = await sails.models.environment
      .findOne({ id: environments.production.id })
      .decrypt()
    expect(stored.envVars).toEqual(environmentValues)
    expect(stored.envVarMetadata).toEqual(envVarMetadata)
    expect(
      (await sails.models.bearingfeedback.findOne({ id: feedback.id })).title
    ).toBe(title)
    expect(
      (await sails.models.bearingupdate.findOne({ id: update.id })).body
    ).toBe(update.body)
    // Unknown variables stay private inside configuration and diagnostics.
    expect(sails.hooks.secrets.protect(persisted).secureEnvVars.BRAND).toBe(
      '[REDACTED]'
    )
    expect(sails.hooks.secrets.text(details)).toBe(
      'Help [REDACTED] grow. Contact [REDACTED].'
    )
  }
)
