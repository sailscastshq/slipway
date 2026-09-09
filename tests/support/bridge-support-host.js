const crypto = require('node:crypto')
const { Sails } = require('sails')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const defineHook = require(process.env.SLIPWAY_HOOK_PACKAGE_UNDER_TEST ||
  '../../packages/hook')
const grants = require('../../api/lib/bridge-support-grants')
module.exports = async function supportHost(
  sails,
  world,
  { prefix = '' } = {}
) {
  const app = world.current.apps.web,
    secret = crypto.randomBytes(32).toString('hex')
  await sails.models.app
    .updateOne({ id: app.id })
    .set({ bridgeEnabled: true, bridgeSecret: secret })
  const fixture = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-support-host-')
  )
  const host = new Sails()
  let writes = 0
  try {
    await new Promise((resolve, reject) =>
      host.lift(
        {
          appPath: fixture,
          port: 0,
          explicitHost: '127.0.0.1',
          globals: false,
          hooks: { orm: false, grunt: false, slipway: defineHook },
          session: {
            secret: 'isolated-support-host-session-secret',
            saveUninitialized: false
          },
          log: { level: 'error' },
          slipway: {
            lookout: { enabled: false },
            flags: { enabled: false },
            identity: { model: 'creator', sessionKey: 'creatorId' },
            bridge: {
              enabled: true,
              routePath: prefix,
              appId: String(app.id),
              secret,
              exchangeUrl: `http://127.0.0.1:${
                sails.hooks.http.server.address().port
              }/api/v1/bridge/exchange`,
              impersonation: {
                enabled: true,
                readOnlyPaths: ['/', '/write', '/export', '/csp', '/raw']
              }
            }
          },
          bootstrap: function (done) {
            host.models = {
              creator: {
                primaryKey: 'id',
                findOne: async ({ id }) =>
                  ['operator', 'customer', 'admin'].includes(id)
                    ? {
                        id,
                        fullName: id === 'customer' ? 'Ada Customer' : id,
                        isAdmin: id === 'admin'
                      }
                    : null,
                update: () => {
                  writes++
                  return {}
                }
              }
            }
            done()
          },
          routes: {
            [`GET ${prefix}/login`]: (req, res) => {
              req.session.creatorId = 'operator'
              res.json({ loggedIn: true })
            },
            [`GET ${prefix}/`]: (req, res) =>
              res
                .type('html')
                .send(
                  `<!doctype html><html><head><title>Creator app</title></head><body><h1>${
                    req.session.creatorId || 'anonymous'
                  }</h1></body></html>`
                ),
            [`GET ${prefix}/write`]: (req, res) => {
              host.models.creator.update({})
              res.type('html').send('<html><body>updated</body></html>')
            },
            [`GET ${prefix}/export`]: (_req, res) =>
              res.json({ privateExport: true }),
            [`GET ${prefix}/csp`]: (_req, res) => {
              res.set('Content-Security-Policy', "default-src 'none'")
              res.type('html').send('<html><body>private</body></html>')
            },
            [`GET ${prefix}/raw`]: (_req, res) =>
              res.end('<html><body>no banner</body></html>')
          }
        },
        (error) => (error ? reject(error) : resolve())
      )
    )
    const port = host.hooks.http.server.address().port
    const origin = `http://127.0.0.1:${port}`
    async function issue(subject = 'customer') {
      const code = crypto.randomBytes(32).toString('hex')
      const grant = await sails.models.bridgesupportgrant
        .create({
          tokenHash: grants.hash(code),
          credentialHash: grants.hash(secret),
          app: app.id,
          actor: world.current.users.genesisUser.id,
          scope: {
            actor: String(world.current.users.genesisUser.id),
            subject,
            model: 'creator',
            mode: 'read-only',
            reason: 'Investigate account state',
            team: world.current.teams.genesisTeam.id,
            returnPath: '/projects/support-host'
          },
          expiresAt: Date.now() + 120000,
          endsAt: Date.now() + 900000
        })
        .fetch()
      return { code, grant }
    }
    return {
      host,
      origin,
      app,
      secret,
      issue,
      writes: () => writes,
      async close() {
        await host.hooks.slipway?.supportView?.stop()
        await new Promise((resolve) => host.lower(resolve))
        await fs.rm(fixture, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await host.hooks.slipway?.supportView?.stop()
    await new Promise((resolve) => host.lower(resolve))
    await fs.rm(fixture, { recursive: true, force: true })
    throw error
  }
}
