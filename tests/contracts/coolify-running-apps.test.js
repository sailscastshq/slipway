const { test } = require('sounding')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const run = promisify(execFile)
const inventory = require('../fixtures/coolify-migration/inventory.json')
const proxyImage =
  'lucaslorentz/caddy-docker-proxy@sha256:f3ebe7e762bccf17ce38b88420f80ce63f69dc548eea0cd6e5f29db2ae2ea062'

test(
  'three running Sails apps migrate disposable PostgreSQL and Redis through real health, Bridge, Helm, Lookout and Caddy cutover/rollback',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'migration-running' } }
    }
  },
  async ({ sails, world }) => {
    assert.equal(
      process.platform,
      'linux',
      'Use the disposable Linux CI runner'
    )
    const deps = process.env.SLIPWAY_MIGRATION_DEPS
    assert.ok(deps, 'Prepare pinned test-only PostgreSQL adapter dependencies')
    assert.ok(
      !process.env.SLIPWAY_DOCKER_BINARY,
      'Use the normal local Docker executable'
    )
    const selected = JSON.parse(
      (await run('docker', ['context', 'inspect'])).stdout
    )[0].Endpoints.docker.Host
    assert.ok(
      selected.startsWith('unix://'),
      'Only a local disposable Docker context'
    )
    assert.ok(
      !process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://'),
      'No remote daemon'
    )
    const prefix = `slipway-migration-${randomUUID().slice(0, 8)}`
    const network = prefix,
      pg = `${prefix}-pg`,
      redis = `${prefix}-redis`,
      proxy = `${prefix}-proxy`
    const created = []
    const evidence = {
      head: (await run('git', ['rev-parse', 'HEAD'])).stdout.trim(),
      scope:
        'synthetic Linux Sails apps; local HTTP only; no DNS/TLS or production data',
      apps: [],
      checks: []
    }
    const original = {
      network: sails.config.custom.slipwayNetwork,
      proxy: sails.config.custom.slipwayProxyContainer,
      ingress: sails.config.custom.slipwayIngress,
      finish: sails.helpers.caddy.finishRouteUpdate
    }
    const command = (args) =>
      run('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024 })
    const start = async (name, args) => {
      created.push(name)
      await command(['run', '-d', '--name', name, ...args])
    }
    const sql = (database, statement) =>
      command([
        'exec',
        pg,
        'psql',
        '-U',
        'postgres',
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
        '-Atc',
        statement
      ])
    let madeNetwork = false
    try {
      for (const image of [
        'node:22-bookworm',
        'postgres:17-alpine',
        'redis:7-alpine',
        'alpine',
        proxyImage
      ])
        await command(['image', 'inspect', image])
      await command(['network', 'create', network])
      madeNetwork = true
      sails.config.custom.slipwayNetwork = network
      sails.config.custom.slipwayProxyContainer = proxy
      sails.config.custom.slipwayIngress = 'cloudflare-tunnel'
      await start(pg, [
        '--network',
        network,
        '--memory',
        '256m',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,size=128m',
        '-e',
        'POSTGRES_PASSWORD=fixture-only',
        'postgres:17-alpine'
      ])
      await waitFor(async () => {
        await command([
          'exec',
          pg,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'postgres'
        ])
        return true
      })
      await start(redis, [
        '--network',
        network,
        '--memory',
        '64m',
        'redis:7-alpine',
        'redis-server',
        '--save',
        '',
        '--appendonly',
        'no'
      ])
      await command(['exec', redis, 'redis-cli', 'PING'])
      await start(proxy, [
        '--network',
        network,
        '-v',
        '/var/run/docker.sock:/var/run/docker.sock:ro',
        '-e',
        `CADDY_INGRESS_NETWORKS=${network}`,
        proxyImage
      ])
      const apps = []
      for (let i = 0; i < inventory.length; i++) {
        const item = inventory[i],
          source = `source_${i}`,
          target = i === 0 ? source : `target_${i}`
        await sql('postgres', `CREATE DATABASE ${source}`)
        await sql(
          source,
          "CREATE TABLE sample(id serial PRIMARY KEY,name varchar(255) NOT NULL);INSERT INTO sample(name) VALUES ('disposable-one'),('disposable-two')"
        )
        if (i !== 0) {
          await sql('postgres', `CREATE DATABASE ${target}`)
          await command([
            'exec',
            pg,
            'pg_dump',
            '-U',
            'postgres',
            '-Fc',
            '-f',
            `/tmp/${source}.dump`,
            source
          ])
          await command([
            'exec',
            pg,
            'pg_restore',
            '-U',
            'postgres',
            '--exit-on-error',
            '-d',
            target,
            `/tmp/${source}.dump`
          ])
          assert.equal(
            (await sql(target, 'SELECT count(*) FROM sample')).stdout.trim(),
            '2'
          )
        }
        const queue = `${prefix}:${i}:jobs`
        await command([
          'exec',
          redis,
          'redis-cli',
          'RPUSH',
          queue,
          'disposable-marker'
        ])
        const project = await world.create('project').with({
          slug: `${prefix}-${i}`,
          team: world.current.teams.genesisTeam.id,
          createdBy: world.current.users.genesisUser.id
        })
        const environment = await world
          .create('environment')
          .trait('production')
          .with({ project: project.id, domain: item.domain })
        const app = await world.create('app').with({
          environment: environment.id,
          status: 'running',
          slug: 'web',
          name: item.project,
          port: 1337,
          hostPort: 1337,
          healthPath: item.healthPath
        })
        const deployment = await world.create('deployment').with({
          environment: environment.id,
          triggeredBy: world.current.users.genesisUser.id,
          status: 'deploying'
        })
        const names = {
          old: `${prefix}-${i}-old`,
          candidate: `${prefix}-${i}-candidate`
        }
        for (const [version, name] of Object.entries(names)) {
          const database = version === 'old' ? source : target
          await start(name, [
            '--init',
            '--network',
            network,
            '--memory',
            '384m',
            '--tmpfs',
            '/app:rw,size=16m',
            '--tmpfs',
            '/tmp:rw,size=32m',
            '-v',
            `${path.resolve('.')}:/host:ro`,
            '-v',
            `${await fs.realpath('node_modules')}:/fixture/node_modules:ro`,
            '-v',
            `${path.resolve('packages')}:/fixture/packages:ro`,
            '-v',
            `${path.resolve('assets')}:/fixture/assets:ro`,
            '-v',
            `${path.resolve(deps)}:/pgdeps/node_modules:ro`,
            '-w',
            '/app',
            '-e',
            'NODE_ENV=production',
            '-e',
            `DATABASE_URL=postgresql://postgres:fixture-only@${pg}/${database}`,
            '-e',
            `REDIS_URL=redis://${redis}:6379/0`,
            '-e',
            `SESSION_SECRET=fixture-secret-${prefix}-${i}`,
            '-e',
            `FIXTURE_SESSION_PREFIX=${prefix}:${i}:sessions:`,
            '-e',
            `QUEUE_NAMESPACE=${queue}`,
            '-e',
            `FIXTURE_APP=${item.project}`,
            '-e',
            `FIXTURE_HEALTH_PATH=${item.healthPath}`,
            '-e',
            `FIXTURE_VERSION=${version}`,
            '-e',
            `SLIPWAY_APP_ID=${app.id}`,
            '-e',
            `SLIPWAY_DEPLOYMENT_ID=${deployment.id}`,
            i === 2 ? 'node:24-bookworm' : 'node:22-bookworm',
            'node',
            '/host/tests/fixtures/coolify-migration/running.cjs'
          ])
          const health = await sails.helpers.docker.healthCheckContainer.with({
            containerName: name,
            port: 1337,
            path: item.healthPath,
            timeout: 60000,
            interval: 500
          })
          assert.ok(health.attempts > 0)
        }
        await sails.models.app
          .updateOne({ id: app.id })
          .set({ containerName: names.old, currentDeployment: deployment.id })
        await sails.helpers.caddy.updateRoute.with({
          environmentId: String(environment.id),
          routeVersion: `${deployment.id}-old`
        })
        const fetchRoute = async (cookie = '') =>
          JSON.parse(
            (
              await command([
                'exec',
                names.old,
                'node',
                '-e',
                `require('http').get({hostname:${JSON.stringify(
                  proxy
                )},port:80,path:'/',headers:{host:${JSON.stringify(
                  item.domain
                )},cookie:${JSON.stringify(
                  cookie
                )}}},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,body:JSON.parse(b),cookies:r.headers['set-cookie']})))}).on('error',e=>{console.error(e.message);process.exit(1)})`
              ])
            ).stdout
          )
        const before = await fetchRoute()
        assert.equal(before.body.version, 'old')
        assert.equal(before.body.rows, 2)
        assert.equal(before.body.queued, 1)
        const cookie = before.cookies[0].split(';')[0]
        // Fail actual target health; the source route keeps working.
        await command(['exec', names.candidate, 'touch', '/tmp/unhealthy'])
        await assert.rejects(
          sails.helpers.docker.healthCheckContainer.with({
            containerName: names.candidate,
            port: 1337,
            path: item.healthPath,
            timeout: 1500,
            interval: 200
          }),
          /health check failed/i
        )
        assert.equal((await fetchRoute(cookie)).body.version, 'old')
        await command(['exec', names.candidate, 'rm', '/tmp/unhealthy'])
        // Real warm Bridge worker and isolated Helm execution against the target DB.
        const bridge = await sails.helpers.bridge.executeInContainer.with({
          containerName: names.candidate,
          code: 'return await sails.models.sample.find().sort("id ASC")',
          idleTimeoutMs: 1000
        })
        assert.equal(bridge.success, true, bridge.error)
        assert.equal(JSON.parse(bridge.output).length, 2)
        const helm = await sails.helpers.helm.executeInContainer.with({
          containerName: names.candidate,
          source: 'await Sample.count()',
          executionId: randomUUID(),
          expectedRuntime: {
            appId: String(app.id),
            deploymentId: String(deployment.id),
            required: true
          }
        })
        assert.equal(helm.success, true, helm.error?.message)
        assert.equal(helm.value, 2)
        const candidate = {
          containerName: names.candidate,
          containerId: names.candidate,
          port: 1337,
          hostPort: 1337,
          healthPath: item.healthPath
        }
        // Inject interruption at the route commit boundary; real rollback restores
        // route + App metadata. No SQL/import is replayed during recovery.
        sails.helpers.caddy.finishRouteUpdate = {
          with: async (input) => {
            if (input.action === 'commit')
              throw new Error('fixture interruption before route commit')
            return original.finish.with(input)
          }
        }
        await assert.rejects(
          sails.helpers.deploy.cutoverTraffic.with({
            deploymentId: String(deployment.id),
            environmentId: String(environment.id),
            appId: String(app.id),
            candidate
          }),
          /rolled back/
        )
        sails.helpers.caddy.finishRouteUpdate = original.finish
        assert.equal(
          (await sails.models.app.findOne({ id: app.id })).containerName,
          names.old
        )
        assert.equal((await fetchRoute(cookie)).body.version, 'old')
        await sails.helpers.deploy.cutoverTraffic.with({
          deploymentId: String(deployment.id),
          environmentId: String(environment.id),
          appId: String(app.id),
          candidate
        })
        const after = await fetchRoute(cookie)
        assert.equal(after.body.version, 'candidate')
        assert.equal(after.body.rows, 2)
        assert.equal(after.body.queued, 1)
        assert.ok(
          after.body.visits > before.body.visits,
          'Redis session survived'
        )
        await sails.helpers.deploy.cutoverTraffic.with({
          deploymentId: String(deployment.id),
          environmentId: String(environment.id),
          appId: String(app.id),
          candidate: {
            ...candidate,
            containerName: names.old,
            containerId: names.old
          }
        })
        assert.equal((await fetchRoute(cookie)).body.version, 'old')
        apps.push({
          app,
          item,
          source,
          target,
          names,
          environment,
          deployment,
          candidate,
          fetchRoute,
          cookie
        })
        evidence.apps.push({
          name: item.project,
          databaseChoice: item.postgres.choice,
          health: item.healthPath,
          sourceRows: 2,
          targetRows: 2,
          checks: [
            'healthy source and target',
            'failed health preserves old traffic',
            'Bridge Waterline records',
            'Helm exact-runtime count',
            'interruption rollback',
            'Caddy cutover',
            'Redis session and queue continuity',
            'app rollback before divergent writes'
          ]
        })
      }
      // Failed import runs against disposable managed target only, never source.
      const managed = apps[1]
      await command([
        'exec',
        pg,
        'sh',
        '-c',
        'printf invalid > /tmp/invalid.dump'
      ])
      await assert.rejects(
        command([
          'exec',
          pg,
          'pg_restore',
          '-U',
          'postgres',
          '--exit-on-error',
          '-d',
          managed.target,
          '/tmp/invalid.dump'
        ])
      )
      assert.equal(
        (
          await sql(managed.source, 'SELECT count(*) FROM sample')
        ).stdout.trim(),
        '2'
      )
      assert.equal(
        (
          await sql(managed.target, 'SELECT count(*) FROM sample')
        ).stdout.trim(),
        '2'
      )
      // Deliberately expose the point where an app rollback is not data rollback.
      await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: String(managed.deployment.id),
        environmentId: String(managed.environment.id),
        appId: String(managed.app.id),
        candidate: managed.candidate
      })
      await sql(
        managed.target,
        "INSERT INTO sample(name) VALUES ('post-cutover-fixture')"
      )
      assert.equal((await managed.fetchRoute(managed.cookie)).body.rows, 3)
      assert.equal(
        (
          await sql(managed.target, 'SELECT count(*) FROM sample')
        ).stdout.trim(),
        '3'
      )
      assert.equal(
        (
          await sql(managed.source, 'SELECT count(*) FROM sample')
        ).stdout.trim(),
        '2'
      )
      evidence.checks.push(
        'failed import leaves source and reviewed target intact',
        'divergent target write requires reconciliation before database rollback'
      )
      const metrics = await sails.helpers.lookout.collectContainerMetrics()
      for (const { app, names } of apps) {
        const metric = metrics.records.find(
          (row) =>
            row.containerName === names.old &&
            String(row.app) === String(app.id)
        )
        assert.ok(
          metric,
          'Lookout stores real Docker metrics for each current app'
        )
        assert.ok(metric.memoryUsage > 0)
        const inspect = JSON.parse(
          (await command(['inspect', names.candidate])).stdout
        )[0]
        assert.equal(inspect.HostConfig.Privileged, false)
        assert.deepEqual(inspect.HostConfig.PortBindings || {}, {})
      }
      evidence.checks.push(
        'Lookout real per-app CPU/memory samples',
        'no privileged app or published app ports'
      )
      evidence.passed = true
    } finally {
      sails.helpers.caddy.finishRouteUpdate = original.finish
      await fs.mkdir('.tmp/migration-proof', { recursive: true })
      if (!evidence.passed) {
        for (const name of created) {
          const logs = await command(['logs', '--tail', '80', name]).catch(
            () => ({ stdout: '', stderr: '' })
          )
          await fs.writeFile(
            `.tmp/migration-proof/${name}.log`,
            (logs.stdout + logs.stderr).replaceAll(
              'fixture-only',
              '[fixture credential]'
            )
          )
        }
      }
      // Exact fixture network owns all route-label and app containers.
      if (madeNetwork) {
        const ids = (
          await command(['ps', '-aq', '--filter', `network=${network}`])
        ).stdout
          .trim()
          .split(/\s+/)
          .filter(Boolean)
        if (ids.length) await command(['rm', '-f', ...ids])
        await command(['network', 'rm', network])
      }
      sails.config.custom.slipwayNetwork = original.network
      sails.config.custom.slipwayProxyContainer = original.proxy
      sails.config.custom.slipwayIngress = original.ingress
      await fs.mkdir('.tmp/migration-proof', { recursive: true })
      await fs.writeFile(
        '.tmp/migration-proof/evidence.json',
        JSON.stringify(evidence, null, 2) + '\n'
      )
    }
  }
)

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (await check()) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Disposable service did not become ready')
}
