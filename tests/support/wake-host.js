const { Sails } = require('sails')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const defineHook = require(process.env.SLIPWAY_HOOK_PACKAGE_UNDER_TEST ||
  '../../packages/hook')
module.exports = async function wakeHost(
  sails,
  world,
  {
    sessionless = false,
    requireConsent = true,
    mode = 'first-party',
    prefix = '/academy'
  } = {}
) {
  const app = world.current.apps.web
  const token = `swk_${crypto.randomBytes(32).toString('hex')}`
  const deployment = await sails.models.deployment
    .create({ app: app.id, environment: app.environment })
    .fetch()
  await sails.models.app
    .updateOne({ id: app.id })
    .set({ wakeEnabled: true, wakeSecret: token })
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'slipway-wake-host-'))
  const reservation = require('node:net').createServer()
  await new Promise((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', resolve)
  })
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const host = new Sails()
  const html = `<!doctype html><html><head><title>Wake TBJS verification</title></head><body><main><h1>Creator workspace</h1><a href="${prefix}/pricing">Pricing</a><button data-slipway-goal="start-checkout">Start checkout</button></main></body></html>`
  try {
    await new Promise((resolve, reject) =>
      host.lift(
        {
          appPath: fixture,
          port,
          explicitHost: '127.0.0.1',
          globals: false,
          hooks: {
            orm: false,
            grunt: false,
            slipway: defineHook,
            ...(sessionless ? { session: false } : {})
          },
          session: {
            secret: 'wake-isolated-test-session-secret',
            saveUninitialized: false
          },
          security: { csrf: !sessionless },
          log: { level: 'error' },
          slipway: {
            identity: { model: 'creator', sessionKey: 'creatorId' },
            lookout: { enabled: false },
            flags: { enabled: false },
            wake: {
              enabled: true,
              secret: token,
              appId: String(app.id),
              deploymentId: String(deployment.id),
              routePath: prefix,
              allowTestTraffic: true,
              ingestUrl: `http://127.0.0.1:${
                sails.hooks.http.server.address().port
              }/api/v1/wake/ingest`
            }
          },
          routes: {
            [`GET ${prefix}/pricing`]: (req, res) =>
              res.type('html').send(html),
            [`GET ${prefix}/_fixture/login/:id`]: (req, res) => {
              if (req.session)
                req.session.creatorId =
                  req.params.id === 'logout' ? null : req.params.id
              res.redirect(`${prefix}/pricing`)
            },
            [`POST ${prefix}/protected`]: (req, res) =>
              res.json({ changed: true }),
            [`GET ${prefix}/strict`]: (req, res) => {
              res.setHeader('content-security-policy', "script-src 'none'")
              res.type('html').send(html)
            },
            [`GET ${prefix}/stream`]: (req, res) => {
              res.type('html')
              res.write('<html><body>')
              res.end('Streamed</body></html>')
            },
            [`GET ${prefix}/manual`]: (req, res) =>
              res
                .type('html')
                .send(
                  html.replace(
                    '</body>',
                    `<script data-slipway-wake src="${prefix}/_slipway/wake.js"></script></body>`
                  )
                )
          }
        },
        (error) => (error ? reject(error) : resolve())
      )
    )
    host.models ||= {}
    host.models.creator = {
      findOne: async ({ id }) => ({ id, email: 'not-collected@example.test' })
    }
    const origin = `http://127.0.0.1:${host.hooks.http.server.address().port}`
    const settings = {
      allowedOrigins: [origin],
      requireConsent,
      mode,
      excludedPaths: [`${prefix}/_fixture/*`]
    }
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ wakeSettings: settings })
    // Allow initial registration to settle before explicitly refreshing settings.
    for (
      let i = 0;
      i < 100 && host.hooks.slipway.wake.getStatus() === 'connecting';
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10))
    await host.hooks.slipway.wake.refresh()
    if (host.hooks.slipway.wake.getStatus() !== 'collecting')
      throw new Error('Wake runtime failed to acquire a lease')
    return {
      host,
      origin,
      prefix,
      app,
      token,
      deployment,
      settings,
      async rows() {
        await host.hooks.slipway.wake.flush()
        const result = await sails
          .getDatastore('analytics')
          .sendNativeQuery(
            'SELECT * FROM wake_events WHERE app=? ORDER BY id',
            [String(app.id)]
          )
        return result.rows
      },
      async close() {
        await new Promise((resolve) => host.lower(resolve))
        await fs.rm(fixture, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await new Promise((resolve) => host.lower(resolve))
    await fs.rm(fixture, { recursive: true, force: true })
    throw error
  }
}
