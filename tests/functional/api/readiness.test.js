const { test } = require('sounding')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { withCsrfFromPage } = require('../../support/csrf-request')
test(
  'readiness uses one scoped source/configuration report and invalidates changed previews without exposing secrets',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'readiness-contract' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slipway-readiness-'))
    const oldRoot = sails.config.custom.slipwayAppsDir
    sails.config.custom.slipwayAppsDir = root
    const current = world.current
    const source = path.join(root, 'readiness-contract')
    try {
      await fs.mkdir(path.join(source, 'config'), { recursive: true })
      await fs.writeFile(
        path.join(source, 'Dockerfile'),
        'FROM node:22-alpine\nCMD ["node","app.js"]'
      )
      await fs.writeFile(
        path.join(source, 'package.json'),
        JSON.stringify({ dependencies: { sails: '^1.5.0' } })
      )
      const marker = path.join(root, 'must-not-execute')
      await fs.writeFile(
        path.join(source, 'config/session.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(
          marker
        )}, 'executed'); module.exports.session = {secret: process.env.SESSION_SECRET}`
      )
      await sails.models.environment
        .updateOne({ id: current.environments.production.id })
        .set({ envVars: { SESSION_SECRET: 'never-render-this-secret' } })
      const browser = await withCsrfFromPage(request, '/', 'genesisUser')
      const url =
        '/api/v1/projects/readiness-contract/environments/production/readiness'
      const response = await browser.request.get(url)
      expect(response).toHaveStatus(200)
      expect(response.data.canDeploy).toBe(true)
      const shared = await sails.helpers.environment.getReadiness.with({
        environmentId: current.environments.production.id,
        appId: current.apps.web.id
      })
      expect(response.data.version).toBe(shared.version)
      expect(response.data.items).toEqual(shared.items)
      expect(
        JSON.stringify(response.data).includes('never-render-this-secret')
      ).toBe(false)
      expect(await fs.stat(marker).catch(() => null)).toBe(null)
      const page = await browser.request.get(
        '/projects/readiness-contract/environments/production',
        { headers: { 'X-Inertia': 'true' } }
      )
      expect(page.data.props.readiness.version).toBe(shared.version)
      await fs.writeFile(path.join(source, 'app.js'), '// source changed')
      const changed = await browser.request.get(
        url + '?previousVersion=' + shared.version
      )
      expect(changed.data.stale).toBe(true)
      expect(changed.data.sourceRevision === shared.sourceRevision).toBe(false)
      await sails.models.environment
        .updateOne({ id: current.environments.production.id })
        .set({ envVars: { SESSION_SECRET: 'changed-secret' } })
      const changedConfig = await browser.request.get(
        url + '?previousVersion=' + changed.data.version
      )
      expect(changedConfig.data.stale).toBe(true)
      expect(await browser.request.get(url + '?app=other-app')).toHaveStatus(
        404
      )
      const other = await world.create('team').with({
        name: 'Other readiness team',
        owner: current.users.genesisUser.id
      })
      await world
        .create('project')
        .with({ slug: 'other-readiness', team: other.id })
      expect(
        await browser.request.get(
          '/api/v1/projects/other-readiness/environments/production/readiness'
        )
      ).toHaveStatus(403)
    } finally {
      sails.config.custom.slipwayAppsDir = oldRoot
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
