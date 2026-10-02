const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('sounding')
const inventory = require('../../fixtures/coolify-migration/inventory.json')
const writeSource = require('../../fixtures/coolify-migration/source')

test(
  'three synthetic Coolify apps have isolated source/config readiness and secret-free repeatable admission checks',
  { world: { name: 'configured-slipway', context: { cliActor: true } } },
  async ({ sails, world, request }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slipway-migration-'))
    const previousRoot = sails.config.custom.slipwayAppsDir
    sails.config.custom.slipwayAppsDir = root
    const prepared = []
    try {
      assert.equal(inventory.length, 3)
      for (const fixture of inventory) {
        const project = await world.create('project').with({
          slug: fixture.project,
          team: world.current.teams.genesisTeam.id,
          createdBy: world.current.users.genesisUser.id
        })
        const environment = await world
          .create('environment')
          .trait('production')
          .with({ project: project.id, domain: fixture.domain })
        const app = await world.create('app').trait('configured').with({
          slug: fixture.app,
          environment: environment.id,
          healthPath: fixture.healthPath
        })
        const source = await writeSource(root, fixture)
        const url = `/api/v1/projects/${project.slug}/environments/production/readiness?app=${app.slug}`
        const get = async (suffix = '') => {
          const response = await request.as('genesisUser').get(url + suffix)
          assert.equal(response.status, 200)
          return response.data
        }
        const missing = await get()
        assert.equal(missing.canDeploy, false)
        for (const name of fixture.requiredEnv)
          assert.ok(JSON.stringify(missing).includes(name), name)

        // These deliberately unreachable values are inspected as data, never used
        // as connection targets. Keep values out of inventories and reports.
        const values = {
          DATABASE_URL: `postgresql://fixture:never-output-this@db.invalid/${fixture.postgres.database}`,
          REDIS_URL: 'redis://fixture:never-output-this@redis.invalid/0',
          ...(fixture.redis.role === 'sessions'
            ? { SESSION_SECRET: `never-output-this-${fixture.project}` }
            : { QUEUE_NAMESPACE: fixture.redis.namespace })
        }
        await sails.models.environment
          .updateOne({ id: environment.id })
          .set({ envVars: values })
        const ready = await get()
        assert.equal(ready.canDeploy, true)
        assert.equal(ready.appId, app.id)
        assert.equal(ready.environmentId, environment.id)
        assert.equal(ready.healthPath, fixture.healthPath)
        assert.equal(
          ready.items.find((x) => x.id === 'datastore').status,
          'pass'
        )
        assert.equal(ready.items.find((x) => x.id === 'source').status, 'pass')
        assert.equal(ready.items.find((x) => x.id === 'node').status, 'pass')
        assert.equal(JSON.stringify(ready).includes('never-output-this'), false)
        assert.equal(JSON.stringify(ready).includes('db.invalid'), false)
        assert.equal(JSON.stringify(ready).includes('redis.invalid'), false)
        const repeated = await get()
        assert.equal(repeated.version, ready.version)
        assert.deepEqual(repeated.items, ready.items)
        prepared.push({ fixture, environment, app, source, ready, get, values })
      }

      assert.equal(new Set(prepared.map((x) => x.ready.sourceRevision)).size, 3)
      const [atlas, harbor, beacon] = prepared
      await fs.appendFile(path.join(atlas.source, 'app.js'), '// next source\n')
      const changed = await atlas.get(`&previousVersion=${atlas.ready.version}`)
      assert.equal(changed.stale, true)
      assert.notEqual(changed.sourceRevision, atlas.ready.sourceRevision)
      assert.equal((await harbor.get()).version, harbor.ready.version)
      assert.equal((await beacon.get()).version, beacon.ready.version)

      // A previous healthy deployment cannot certify changed configuration.
      await sails.helpers.setting.set(
        `readiness-health-${harbor.app.id}`,
        JSON.stringify({
          version: harbor.ready.version,
          success: true,
          checkedAt: Date.now()
        })
      )
      await sails.models.environment
        .updateOne({ id: harbor.environment.id })
        .set({
          envVars: { ...harbor.values, SESSION_SECRET: 'changed-fixture' }
        })
      const staleProbe = await harbor.get(
        `&previousVersion=${harbor.ready.version}`
      )
      assert.equal(staleProbe.stale, true)
      assert.equal(staleProbe.lastProbe.stale, true)
      assert.equal(
        staleProbe.items.find((x) => x.id === 'health').status,
        'warning'
      )

      // Reachable external service metadata must match the effective runtime URL.
      const external = await world.create('service').with({
        environment: atlas.environment.id,
        name: 'source-postgres',
        type: 'postgresql',
        managementMode: 'external',
        status: 'reachable',
        envVarKey: 'DATABASE_URL',
        externalVerification: {
          connectionFingerprint: crypto
            .createHmac(
              'sha256',
              sails.config.models.dataEncryptionKeys.default
            )
            .update(atlas.values.DATABASE_URL)
            .digest('hex')
        }
      })
      const verified = await atlas.get()
      assert.equal(
        verified.items.find((x) => x.id === 'datastore').status,
        'pass'
      )
      assert.match(
        verified.items.find((x) => x.id === 'datastore').evidence,
        /passed its last connection and read-permission check/
      )
      await sails.models.service
        .updateOne({ id: external.id })
        .set({ status: 'unreachable' })
      const unavailable = await atlas.get()
      assert.equal(
        unavailable.items.find((x) => x.id === 'datastore').status,
        'pass'
      )
      assert.match(
        unavailable.items.find((x) => x.id === 'datastore').evidence,
        /Reachability is checked when the app starts/
      )
      assert.equal(
        unavailable.canDeploy,
        true,
        'connectivity remains an app health responsibility'
      )

      // Missing a required queue variable blocks only that app, without executing
      // its source, provisioning Redis, or pretending that a job was drained.
      const { QUEUE_NAMESPACE, ...withoutQueue } = beacon.values
      await sails.models.environment
        .updateOne({ id: beacon.environment.id })
        .set({ envVars: withoutQueue })
      assert.equal((await beacon.get()).canDeploy, false)
      assert.equal((await atlas.get()).canDeploy, true)
      assert.equal((await harbor.get()).canDeploy, true)
    } finally {
      sails.config.custom.slipwayAppsDir = previousRoot
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
