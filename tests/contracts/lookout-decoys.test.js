const { test } = require('sounding')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomBytes } = require('node:crypto')
const routeLabels = require('../../api/helpers/caddy/update-route')._private
  .buildRouteLabels
const decoys = require('../../api/helpers/lookout/decoy-config')._private
const { observations, readLog } =
  require('../../api/helpers/lookout/collect-decoys')._private
const exec = promisify(execFile)
const images = [
  'lucaslorentz/caddy-docker-proxy:2.13.1',
  'lucaslorentz/caddy-docker-proxy@sha256:f3ebe7e762bccf17ce38b88420f80ce63f69dc548eea0cd6e5f29db2ae2ea062'
]

test(
  'real namespaced Caddy labels serve exact decoys and collect only bounded secret-free observations',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'decoy-proxy' } }
    }
  },
  async ({ sails, world }) => {
    for (const image of images) {
      const id = `decoyfixture${randomBytes(5).toString('hex')}`
      const proxy = `${id}-proxy`,
        appName = `${id}-app`,
        route = `${id}-route`
      const run = (args) =>
        exec('docker', args, { timeout: 120000, maxBuffer: 1024 * 1024 })
      const app = {
        id: String(world.current.apps.web.id),
        slug: 'web',
        environment: String(world.current.environments.production.id),
        bridgeEnabled: true,
        routePath: '/',
        containerName: appName,
        port: 8080,
        lookoutDecoys: {
          enabled: true,
          paths: ['/.env', '/config/database.yml'],
          revision: 'a'.repeat(32)
        }
      }
      const prefixApp = {
        ...app,
        id: 'prefix-fixture',
        routePath: '/api',
        bridgeEnabled: false,
        lookoutDecoys: { ...app.lookoutDecoys, paths: ['/.env'] }
      }
      const originalProxy = sails.config.custom.slipwayProxyContainer
      try {
        await run(['network', 'create', id])
        await run([
          'run',
          '-d',
          '--name',
          proxy,
          '--network',
          id,
          '-v',
          '/var/run/docker.sock:/var/run/docker.sock:ro',
          '-e',
          `CADDY_DOCKER_LABEL_PREFIX=${id}`,
          '-e',
          `CADDY_INGRESS_NETWORKS=${id}`,
          image
        ])
        await run([
          'run',
          '-d',
          '--name',
          appName,
          '--network',
          id,
          'node:22-alpine',
          'node',
          '-e',
          "require('http').createServer((q,r)=>{r.statusCode=q.url==='/normal'?201:404;r.end('upstream:'+q.method+':'+q.url)}).listen(8080)"
        ])
        const labels = routeLabels({
          projectSlug: 'fixture',
          environmentSlug: 'local',
          routableApps: [app, prefixApp],
          controlPlaneUpstream: `${appName}:8080`
        })
        const args = [
          'run',
          '-d',
          '--name',
          route,
          '--network',
          id,
          '--label',
          `${id}=http://fixture.test`
        ]
        for (const label of labels) args.push('--label', id + label.slice(5))
        args.push('alpine', 'sleep', 'infinity')
        await run(args)
        const fetchPath = async (path, method = 'GET') =>
          JSON.parse(
            (
              await run([
                'exec',
                appName,
                'node',
                '-e',
                `const q=require('http').request({hostname:${JSON.stringify(
                  proxy
                )},port:80,path:${JSON.stringify(path)},method:${JSON.stringify(
                  method
                )},headers:{host:'fixture.test',Authorization:'Bearer fixture-secret',Cookie:'token=fixture-secret'}},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,headers:r.headers,body})))});q.on('error',()=>console.log(JSON.stringify({status:0})));q.end()`
              ])
            ).stdout
          )
        let response
        for (let i = 0; i < 100; i++) {
          response = await fetchPath('/.env?token=fixture-secret')
          if (response.status === 200) break
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        assert.equal(response.status, 200, (await run(['logs', proxy])).stderr)
        assert.equal(response.body, '{"ok":true,"data":{}}')
        assert.equal(response.headers['cache-control'], 'no-store')
        assert.equal(response.headers['x-content-type-options'], 'nosniff')
        assert.equal(response.headers['content-type'], 'application/json')
        assert.equal((await fetchPath('/.env', 'HEAD')).body, '')
        for (const [path, method, status] of [
          ['/.env', 'POST', 404],
          ['/.env/extra', 'GET', 404],
          ['/.ENV', 'GET', 404],
          ['/%2eenv', 'GET', 404],
          ['//.env', 'GET', 404],
          ['/unused/../.env', 'GET', 404],
          ['/missing', 'GET', 404],
          ['/normal', 'GET', 201]
        ]) {
          const normal = await fetchPath(path, method)
          assert.equal(normal.status, status)
          assert.equal(normal.body, `upstream:${method}:${path}`)
        }
        assert.equal((await fetchPath('/api/.env')).status, 200)
        assert.equal((await fetchPath('/api/normal')).status, 201)
        assert.equal(
          (await fetchPath('/bridge/launch')).body,
          'upstream:GET:/bridge/launch'
        )
        const file = decoys.logIdentity(app.environment).file
        const raw = await readLog('docker', proxy, file)
        assert.ok(!raw.includes('fixture-secret'))
        assert.ok(
          raw
            .trim()
            .split('\n')
            .every((line) => !Object.hasOwn(JSON.parse(line), 'request'))
        )
        assert.ok(!raw.includes('client_ip'))
        const records = observations(raw, [app, prefixApp])
        assert.ok(records.length >= 2)
        assert.ok(records.every((m) => m.attributes.statusCode === 200))
        assert.ok(
          records.every((m) =>
            ['/.env', '/api/.env'].includes(m.attributes.path)
          )
        )
        assert.ok(
          !(await run(['logs', proxy])).stderr.includes('fixture-secret')
        )
        assert.ok(
          !(await run(['logs', proxy])).stderr
            .split('\n')
            .filter(Boolean)
            .some((line) =>
              JSON.parse(line).logger?.startsWith('http.log.access')
            )
        )
        const adapted = JSON.parse(
          (
            await run([
              'exec',
              proxy,
              'caddy',
              'adapt',
              '--config',
              '/config/caddy/Caddyfile.autosave',
              '--adapter',
              'caddyfile'
            ])
          ).stdout
        )
        const log =
          adapted.logging.logs[decoys.logIdentity(app.environment).name]
        assert.equal(log.writer.roll_size_mb, 2)
        assert.equal(log.writer.roll_keep, 2)
        assert.equal(log.sampling.first, 5)
        assert.equal(log.encoder.fields.request.filter, 'delete')
        assert.ok(
          await sails.models.app
            .updateOne({ id: Number(app.id) })
            .set({ hostPort: 31001 })
        )
        await sails.helpers.setting.set(
          decoys.key(app.id),
          JSON.stringify(app.lookoutDecoys)
        )
        sails.config.custom.slipwayProxyContainer = proxy
        const loaded = await sails.helpers.lookout.decoyConfig(
          await sails.models.app.find({ hostPort: { '>': 0 } })
        )
        assert.ok(
          loaded.some((a) => a.lookoutDecoys.enabled),
          JSON.stringify({
            loaded,
            app,
            allApps: await sails.models.app.find(),
            settings: await sails.models.setting.find({
              key: decoys.key(app.id)
            })
          })
        )
        const firstCollection = await sails.helpers.lookout.collectDecoys()
        assert.ok(firstCollection.admitted >= 2)
        assert.equal((await sails.helpers.lookout.collectDecoys()).admitted, 0)
        const candidateApp = {
          ...app,
          lookoutDecoys: {
            ...app.lookoutDecoys,
            paths: ['/.env.local'],
            revision: 'b'.repeat(32)
          }
        }
        const candidateLabels = routeLabels({
          projectSlug: 'fixture',
          environmentSlug: 'local',
          routableApps: [candidateApp],
          controlPlaneUpstream: `${appName}:8080`
        })
        const candidateArgs = [
          'run',
          '-d',
          '--name',
          `${route}-candidate`,
          '--network',
          id,
          '--label',
          `${id}=http://fixture.test`
        ]
        for (const label of candidateLabels)
          candidateArgs.push('--label', id + label.slice(5))
        candidateArgs.push('alpine', 'sleep', 'infinity')
        await run(candidateArgs)
        await new Promise((resolve) => setTimeout(resolve, 500))
        const stagedConfig = (
          await run([
            'exec',
            proxy,
            'caddy',
            'adapt',
            '--config',
            '/config/caddy/Caddyfile.autosave',
            '--adapter',
            'caddyfile'
          ])
        ).stdout
        assert.ok(stagedConfig.includes('b'.repeat(32)))
        assert.equal((await fetchPath('/.env.local')).status, 404)
        await run(['stop', route])
        let candidateResult
        for (let i = 0; i < 100; i++) {
          candidateResult = await fetchPath('/.env.local')
          if (candidateResult.status === 200) break
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        assert.equal(candidateResult.status, 200)
        const disabledLabels = routeLabels({
          projectSlug: 'fixture',
          environmentSlug: 'local',
          routableApps: [{ ...app, lookoutDecoys: decoys.OFF }],
          controlPlaneUpstream: `${appName}:8080`
        })
        const disabledArgs = [
          'run',
          '-d',
          '--name',
          `${route}-disabled`,
          '--network',
          id,
          '--label',
          `${id}=http://fixture.test`
        ]
        for (const label of disabledLabels)
          disabledArgs.push('--label', id + label.slice(5))
        disabledArgs.push('alpine', 'sleep', 'infinity')
        await run(disabledArgs)
        await run(['stop', `${route}-candidate`])
        await sails.helpers.caddy.verifyRoute.with({
          expectedDomains: ['fixture.test'],
          expectedUpstreams: [`${appName}:8080`],
          excludedDecoys: [decoys.token(candidateApp, '/.env.local')]
        })
        assert.equal((await fetchPath('/.env.local')).status, 404)
        await sails.helpers.setting.set(
          decoys.key(app.id),
          JSON.stringify(decoys.OFF)
        )
        assert.equal((await sails.helpers.lookout.collectDecoys()).admitted, 0)

        assert.ok(
          !(await run(['logs', proxy])).stderr
            .split('\n')
            .filter(Boolean)
            .some((line) =>
              JSON.parse(line).logger?.startsWith('http.log.access')
            )
        )
      } finally {
        sails.config.custom.slipwayProxyContainer = originalProxy
        await sails.helpers.setting.set(
          decoys.key(app.id),
          JSON.stringify(decoys.OFF)
        )
        for (const name of [
          `${route}-disabled`,
          `${route}-candidate`,
          route,
          appName,
          proxy
        ])
          await run(['rm', '-fv', name]).catch(() => {})
        await run(['network', 'rm', id]).catch(() => {})
      }
    }
  }
)
