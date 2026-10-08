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
    // Unknown variables stay private inside configuration and diagnostics.
    expect(sails.hooks.secrets.protect(persisted).secureEnvVars.BRAND).toBe(
      '[REDACTED]'
    )
    expect(sails.hooks.secrets.text(details)).toBe(
      'Help [REDACTED] grow. Contact [REDACTED].'
    )
  }
)
