const { test } = require('sounding')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Blob } = require('node:buffer')
const { randomUUID } = require('node:crypto')
const {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client
} = require('@aws-sdk/client-s3')

const dependencyRoot = process.env.SLIPWAY_STORAGE_EMULATORS

test(
  'Bearing stores screenshots and lets only the original author repair feedback',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'bearing-real-image-upload' }
      }
    }
  },
  async ({ sails, world, request, page: browserPage, expect }) => {
    expect(Boolean(dependencyRoot)).toBe(true)
    const S3rver = require(path.join(dependencyRoot, 's3rver'))
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bearing-upload-'))
    const bucket = 'bearing-images'
    const s3 = new S3rver({
      address: '127.0.0.1',
      port: 0,
      silent: true,
      directory: path.join(root, 's3'),
      configureBuckets: [{ name: bucket }]
    })
    let client

    try {
      const address = await s3.run()
      const endpoint = `http://127.0.0.1:${address.port}`
      client = new S3Client({
        region: 'us-east-1',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' }
      })
      await sails.helpers.setting.set(
        'globalEnvVars',
        JSON.stringify({
          S3_ACCESS_KEY: 'S3RVER',
          S3_SECRET_KEY: 'S3RVER',
          S3_BUCKET: bucket,
          S3_ENDPOINT: endpoint,
          S3_REGION: 'us-east-1',
          S3_PUBLIC_URL: `${endpoint}/${bucket}`
        })
      )

      const current = world.current
      const app = current.apps.web
      const environment = current.environments.production
      const project = current.projects.deploymentTarget
      await sails.models.environment.updateOne({ id: environment.id }).set({
        domain: 'ideas.example.com'
      })
      await sails.models.app.updateOne({ id: app.id }).set({
        bearingEnabled: true
      })
      const secret = await sails.helpers.bearing.ensureAppSecret.with({
        appId: String(app.id),
        rotate: true
      })
      const space = await sails.models.bearingspace
        .create({
          publicSlug: `bearing-storage-${randomUUID()}`,
          app: app.id,
          createdBy: current.users.genesisUser.id,
          allowAnonymousParticipation: true
        })
        .fetch()

      const url = `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}/feedback`
      const browser = request.using('http').withHeaders({
        'x-inertia': 'true',
        'x-requested-with': 'XMLHttpRequest',
        accept: 'text/html, application/xhtml+xml',
        host: 'ideas.example.com',
        'x-forwarded-host': 'ideas.example.com'
      })
      const page = await browser.get(url)
      expect(page).toHaveStatus(200)
      const form = new FormData()
      form.set('category', 'feature')
      form.set('title', 'Attach a real screenshot')
      form.set('imageCount', '1')
      form.set(
        'image0',
        new Blob([Buffer.from('a real image body')], { type: 'image/png' }),
        'screenshot.png'
      )
      const response = await browser
        .withHeaders({
          'x-csrf-token': page.data.props._csrf,
          cookie: page.headers.get('set-cookie').split(';')[0]
        })
        .post(url, form)
      expect(response).toHaveStatus(409)

      const feedback = await sails.models.bearingfeedback.findOne({
        space: space.id,
        title: 'Attach a real screenshot'
      })
      expect(feedback.images.length).toBe(1)
      expect(feedback.images[0].url).toContain(`${endpoint}/${bucket}/bearing/`)
      const feedbackPrefix = [
        'bearing',
        'teams',
        project.team,
        'projects',
        project.id,
        'apps',
        app.id,
        'feedback'
      ].join('/')
      expect(feedback.images[0].objectPath).toContain(
        `${feedbackPrefix}/${feedback.publicId}/`
      )
      const object = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: feedback.images[0].objectPath
        })
      )
      const bytes = await object.Body.transformToByteArray()
      expect(Buffer.from(bytes).toString()).toBe('a real image body')

      const invalidForm = new FormData()
      invalidForm.set('category', 'feature')
      invalidForm.set('title', 'Do not save an SVG')
      invalidForm.set('imageCount', '1')
      invalidForm.set(
        'image0',
        new Blob(['<svg/>'], { type: 'image/svg+xml' }),
        'image.svg'
      )
      const invalid = await browser
        .withHeaders({
          'x-csrf-token': page.data.props._csrf,
          cookie: page.headers.get('set-cookie').split(';')[0]
        })
        .post(url, invalidForm)
      expect(invalid).toHaveStatus(303)
      expect(invalid.header('x-exit')).toBe('badRequest')
      expect(
        await sails.models.bearingfeedback.count({
          space: space.id,
          title: 'Do not save an SVG'
        })
      ).toBe(0)
      const afterRejection = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: 'bearing/' })
      )
      expect((afterRejection.Contents || []).map((item) => item.Key)).toEqual([
        feedback.images[0].objectPath
      ])

      const exchange = await request
        .withHeaders({
          authorization: `Bearer ${secret}`,
          accept: 'application/json'
        })
        .post('/api/v1/bearing/exchange', {
          appId: String(app.id),
          hostUser: {
            id: 'screenshot-author',
            email: 'screenshot-author@example.com',
            fullName: 'Screenshot Author',
            emailVerified: true
          }
        })
      expect(exchange).toHaveStatus(201)
      const participant = await sails.models.bearingparticipant.findOne({
        hostUserId: 'screenshot-author',
        space: space.id
      })
      const authoredFeedback = await sails.models.bearingfeedback
        .create({
          publicId: `bfd_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
          title: 'An existing report without screenshots',
          category: 'bug',
          author: participant.id,
          space: space.id,
          app: app.id
        })
        .fetch()
      const imageUrl = `${url}/${authoredFeedback.publicId}/images`
      const guestAttempt = await browser
        .withHeaders({
          'x-csrf-token': page.data.props._csrf,
          cookie: page.headers.get('set-cookie').split(';')[0]
        })
        .post(imageUrl, { imageCount: 1 })
      expect(guestAttempt).toHaveStatus(403)

      const launchUrl = new URL(exchange.data.launchUrl)
      const launch = await browser.get(
        `${launchUrl.pathname}${launchUrl.search}`
      )
      const launchCookie = launch.headers.get('set-cookie').split(';')[0]
      const author = browser.withHeaders({ cookie: launchCookie })
      const authorPage = await author.get(url)
      expect(authorPage).toHaveStatus(200)
      expect(
        authorPage.data.props.feedback.data.find(
          (item) => item.publicId === authoredFeedback.publicId
        ).viewerCanAddImages
      ).toBe(true)
      const authorCookie =
        authorPage.headers.get('set-cookie')?.split(';')[0] || launchCookie
      const appOrigin = new URL(authorPage.request.url).origin
      await browserPage.raw.context().addCookies([
        {
          name: 'slipway.sid.v2',
          value: authorCookie.slice(authorCookie.indexOf('=') + 1),
          url: appOrigin
        }
      ])
      const privateHostBasePath = url.slice(0, -'/feedback'.length)
      await browserPage.raw.route('**/bearing/**', async (route) => {
        const requestUrl = new URL(route.request().url())
        if (requestUrl.pathname.startsWith('/bearing/')) {
          requestUrl.pathname = `${privateHostBasePath}${requestUrl.pathname.slice(
            '/bearing'.length
          )}`
          await route.continue({ url: requestUrl.toString() })
        } else await route.continue()
      })
      await browserPage.raw.route(
        '**/_slipway/bearing/_assets/**',
        async (route) => {
          const assetUrl = new URL(route.request().url())
          assetUrl.pathname = assetUrl.pathname.replace(
            '/_slipway/bearing/_assets',
            ''
          )
          await route.continue({ url: assetUrl.toString() })
        }
      )
      await browserPage.goto(`${appOrigin}${url}/${authoredFeedback.publicId}`)
      const addScreenshots = browserPage.raw.getByRole('button', {
        name: 'Add screenshots'
      })
      await expect(addScreenshots).toBeVisible()
      await addScreenshots.click()
      await browserPage.raw
        .locator('[data-slot="file-upload"] input[type="file"]')
        .last()
        .setInputFiles({
          name: 'additional.png',
          mimeType: 'image/png',
          buffer: Buffer.from('browser selected screenshot')
        })
      await expect(
        browserPage.raw.getByRole('button', { name: 'Save screenshots' })
      ).toBeEnabled()
      const additionalForm = new FormData()
      additionalForm.set('imageCount', '1')
      additionalForm.set(
        'image0',
        new Blob([Buffer.from('the missing screenshot')], {
          type: 'image/png'
        }),
        'missing.png'
      )
      const added = await author
        .withHeaders({
          cookie: authorCookie,
          'x-csrf-token': authorPage.data.props._csrf
        })
        .post(imageUrl, additionalForm)
      expect(added).toHaveStatus(409)
      const repaired = await sails.models.bearingfeedback.findOne({
        id: authoredFeedback.id
      })
      expect(repaired.images.length).toBe(1)
      expect(repaired.images[0].objectPath).toContain(
        `${feedbackPrefix}/${authoredFeedback.publicId}/`
      )
      const addedObject = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: repaired.images[0].objectPath
        })
      )
      const addedBytes = await addedObject.Body.transformToByteArray()
      expect(Buffer.from(addedBytes).toString()).toBe('the missing screenshot')

      await browserPage.raw
        .getByRole('button', { name: 'Save screenshots' })
        .click()
      await expect(
        browserPage.raw.locator(
          `#bearing-feedback-${authoredFeedback.publicId} img`
        )
      ).toHaveCount(2)
      const withBrowserImage = await sails.models.bearingfeedback.findOne({
        id: authoredFeedback.id
      })
      expect(withBrowserImage.images.length).toBe(2)
      const browserObject = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: withBrowserImage.images[1].objectPath
        })
      )
      const browserBytes = await browserObject.Body.transformToByteArray()
      expect(Buffer.from(browserBytes).toString()).toBe(
        'browser selected screenshot'
      )
      const overLimit = await author
        .withHeaders({
          cookie: authorCookie,
          'x-csrf-token': authorPage.data.props._csrf
        })
        .post(imageUrl, { imageCount: 3 })
      expect(overLimit).toHaveStatus(303)
      expect(overLimit.header('x-exit')).toBe('badRequest')
      expect(
        (
          await sails.models.bearingfeedback.findOne({
            id: authoredFeedback.id
          })
        ).images.length
      ).toBe(2)

      const otherExchange = await request
        .withHeaders({
          authorization: `Bearer ${secret}`,
          accept: 'application/json'
        })
        .post('/api/v1/bearing/exchange', {
          appId: String(app.id),
          hostUser: {
            id: 'someone-else',
            email: 'someone-else@example.com',
            fullName: 'Someone Else',
            emailVerified: true
          }
        })
      const otherLaunchUrl = new URL(otherExchange.data.launchUrl)
      const otherLaunch = await request.get(
        `${otherLaunchUrl.pathname}${otherLaunchUrl.search}`
      )
      const other = request.withSession(otherLaunch.session).withHeaders({
        'x-inertia': 'true',
        'x-requested-with': 'XMLHttpRequest'
      })
      const otherPage = await other.get(url)
      expect(
        otherPage.data.props.feedback.data.find(
          (item) => item.publicId === authoredFeedback.publicId
        ).viewerCanAddImages
      ).toBe(false)
      const otherAttempt = await other
        .withHeaders({ 'x-csrf-token': otherPage.data.props._csrf })
        .post(imageUrl, { imageCount: 1 })
      expect(otherAttempt).toHaveStatus(403)
    } finally {
      client?.destroy()
      await s3.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
