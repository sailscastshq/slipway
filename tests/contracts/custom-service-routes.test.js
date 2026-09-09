const { test } = require('sounding')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const custom = require('../../api/lib/custom-service')
const routes = require('../../api/lib/custom-service-route')

const proxyImage =
  'lucaslorentz/caddy-docker-proxy@sha256:f3ebe7e762bccf17ce38b88420f80ce63f69dc548eea0cd6e5f29db2ae2ea062'

test(
  'real Caddy publishes, replaces, recovers and removes custom HTTP routes without host ports or data loss',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'custom-http-docker' } }
    }
  },
  async ({ sails, world }) => {
    const suffix = crypto.randomBytes(6).toString('hex')
    const network = `slipway-http-test-${suffix}`,
      proxy = `${network}-proxy`,
      containerName = `${network}-service`,
      volume = `${containerName}-data`
    const prefix = `test${suffix}`
    const serviceId = crypto.randomInt(100000000, 900000000)
    const original = {
      command: custom.command,
      network: sails.config.custom.slipwayNetwork,
      proxy: sails.config.custom.slipwayProxyContainer,
      ingress: sails.config.custom.slipwayIngress,
      finish: sails.helpers.caddy.finishRouteUpdate
    }
    const run = original.command
    let madeNetwork = false
    try {
      await run(['network', 'create', network])
      madeNetwork = true
      sails.config.custom.slipwayNetwork = network
      sails.config.custom.slipwayProxyContainer = proxy
      sails.config.custom.slipwayIngress = 'cloudflare-tunnel'
      // Only namespace labels in the transport adapter: the real proxy cannot observe production routes.
      custom.command = (args, timeout) =>
        run(
          args.map((arg, index) =>
            args[index - 1] === '--label' && arg.startsWith('caddy')
              ? prefix + arg.slice(5)
              : arg
          ),
          timeout
        )
      await run([
        'run',
        '-d',
        '--name',
        proxy,
        '--network',
        network,
        '-v',
        '/var/run/docker.sock:/var/run/docker.sock:ro',
        '-e',
        `CADDY_DOCKER_LABEL_PREFIX=${prefix}`,
        '-e',
        `CADDY_INGRESS_NETWORKS=${network}`,
        proxyImage
      ])
      const image = JSON.parse(
        (await run(['image', 'inspect', 'node:22-alpine'])).stdout
      )[0]
      const definition = custom.validate({
        image: 'node:22-alpine',
        name: 'http-test',
        port: 8080,
        volumes: ['/data'],
        command: [
          'node',
          '-e',
          "require('fs').writeFileSync('/data/value','preserved');require('http').createServer((q,r)=>r.end(require('fs').readFileSync('/data/value'))).listen(8080,'0.0.0.0')"
        ],
        healthCommand: [
          'node',
          '-e',
          "fetch('http://127.0.0.1:8080').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      })
      const service = await world.create('service').with({
        id: serviceId,
        type: 'custom',
        name: 'http-test',
        version: 'node:22-alpine',
        imageReference: image.Id,
        status: 'creating',
        containerName,
        internalHost: containerName,
        internalPort: 8080,
        environment: world.current.environments.production.id,
        customDefinition: definition,
        customState: {
          volumes: [{ name: volume, path: '/data' }],
          appIds: [],
          linkPrefix: 'HTTP_TEST'
        }
      })
      await custom.start({ ...service, customDefinition: definition })
      const current = () => sails.models.service.findOne({ id: service.id })
      const actor = {
        user: world.current.users.genesisUser,
        project: world.current.projects.deploymentTarget,
        environment: world.current.environments.production
      }
      const change = async (domain) => {
        const reviewed = await routes.review(
          await current(),
          actor,
          domain,
          8080
        )
        const item = await sails.models.customservicereview
          .findOne({ token: reviewed.id })
          .decrypt()
        return routes.apply(item, actor)
      }
      const fetchRoute = async (domain) =>
        JSON.parse(
          (
            await run([
              'exec',
              containerName,
              'node',
              '-e',
              `require('http').get({hostname:'${proxy}',port:80,path:'/',headers:{host:${JSON.stringify(
                domain
              )}}},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,body}))) }).on('error',()=>console.log(JSON.stringify({status:0,body:''})))`
            ])
          ).stdout
        )
      await change('first.example.test')
      assert.deepEqual(await fetchRoute('first.example.test'), {
        status: 200,
        body: 'preserved'
      })
      const inspected = JSON.parse(
        (await run(['inspect', containerName])).stdout
      )[0]
      assert.deepEqual(inspected.HostConfig.PortBindings || {}, {})
      assert.equal(inspected.HostConfig.Privileged, false)
      await change('second.example.test')
      assert.equal((await fetchRoute('second.example.test')).body, 'preserved')
      assert.notEqual(
        (await fetchRoute('first.example.test')).body,
        'preserved'
      )
      sails.helpers.caddy.finishRouteUpdate = {
        with: async (input) => {
          if (input.action === 'commit') {
            await original.finish.with(input)
            throw new Error('interrupted after cutover')
          }
          throw new Error('recovery unavailable')
        }
      }
      await assert.rejects(change('interrupted.example.test'))
      assert.ok((await current()).publicRoute.operation)
      sails.helpers.caddy.finishRouteUpdate = original.finish
      await routes.recover(await current(), actor)
      assert.equal((await fetchRoute('second.example.test')).body, 'preserved')
      assert.notEqual(
        (await fetchRoute('interrupted.example.test')).body,
        'preserved'
      )
      await change('')
      assert.notEqual(
        (await fetchRoute('second.example.test')).body,
        'preserved'
      )
      assert.equal((await current()).publicRoute.route, 'private')
      assert.equal(
        (await run(['exec', containerName, 'cat', '/data/value'])).stdout,
        'preserved'
      )
    } finally {
      sails.helpers.caddy.finishRouteUpdate = original.finish
      custom.command = original.command
      sails.config.custom.slipwayNetwork = original.network
      sails.config.custom.slipwayProxyContainer = original.proxy
      sails.config.custom.slipwayIngress = original.ingress
      const names = (
        await run(['ps', '-a', '--format', '{{.Names}}']).catch(() => ({
          stdout: ''
        }))
      ).stdout
        .split('\n')
        .filter(
          (name) =>
            name.startsWith(`slipway-route-service-${serviceId}`) ||
            name.startsWith(network)
        )
      for (const name of names) await run(['rm', '-f', name]).catch(() => {})
      await run(['volume', 'rm', volume]).catch(() => {})
      if (madeNetwork) await run(['network', 'rm', network]).catch(() => {})
    }
  }
)
