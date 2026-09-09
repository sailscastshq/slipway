const { test } = require('sounding')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const custom = require('../../api/lib/custom-service')
const { withCsrfFromPage } = require('../support/csrf-request')
test(
  'custom Docker services preserve private runtime, health, app links and retained volumes',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'custom-docker' } }
    }
  },
  async ({ sails, world, request }) => {
    const image = process.env.SLIPWAY_CUSTOM_IMAGE || 'node:22-alpine'
    const network = 'slipway-custom-test-' + crypto.randomUUID()
    const originalNetwork = sails.config.custom.slipwayNetwork,
      originalInspect = custom.inspectImage
    const resources = []
    const command = custom.command
    const privateRoot = process.platform === 'linux' ? '/dev/shm' : os.tmpdir()
    const privateFiles = async () =>
      (await fs.readdir(privateRoot))
        .filter((name) => name.startsWith('slipway-custom-env-'))
        .sort()
    const privateBefore = await privateFiles()
    let madeNetwork = false
    try {
      const metadata = JSON.parse(
        (await command(['image', 'inspect', image])).stdout
      )[0]
      await command(['network', 'create', network])
      madeNetwork = true
      sails.config.custom.slipwayNetwork = network
      custom.inspectImage = async () => metadata
      const browser = await withCsrfFromPage(request, '/', 'genesisUser')
      async function create(name, extra = {}) {
        const response = await browser.request.post(
          '/api/v1/projects/custom-docker/environments/production/services/custom/review',
          {
            definition: {
              image: 'fixture/custom:1',
              name,
              port: 8080,
              volumes: ['/data'],
              command: [
                'node',
                '-e',
                "const fs=require('fs'); if(!fs.existsSync('/data/value'))fs.writeFileSync('/data/value','retained'); console.log('custom-started'); require('http').createServer((req,res)=>res.end('private-response')).listen(8080,'0.0.0.0')"
              ],
              ...extra
            }
          }
        )
        assert.equal(
          response.statusCode || response.status,
          200,
          JSON.stringify(response.data)
        )
        const result = await browser.request.post('/api/v1/services/custom', {
          reviewId: response.data.review.id
        })
        const service = await sails.models.service
          .findOne({
            environment: world.current.environments.production.id,
            name
          })
          .decrypt()
        if (service) resources.push(service)
        assert.equal(
          result.statusCode || result.status,
          201,
          JSON.stringify(result.data)
        )
        return { service, reviewId: response.data.review.id }
      }
      const { service, reviewId } = await create('http-helper', {
        env: { TOKEN: 'private-custom-runtime-value' },
        healthCommand: [
          'wget',
          '-q',
          '-O',
          '/dev/null',
          'http://127.0.0.1:8080'
        ],
        appIds: [String(world.current.apps.web.id)]
      })
      assert.deepEqual(
        await privateFiles(),
        privateBefore,
        'private environment files are removed after Docker reads them'
      )
      assert.equal(service.status, 'running')
      assert.equal(
        service.customState.health,
        'healthy',
        JSON.stringify((await custom.inspectContainer(service)).State)
      )
      const container = await custom.inspectContainer(service)
      assert.equal(container.Image, metadata.Id)
      assert.equal(container.HostConfig.Privileged, false)
      assert.equal(container.HostConfig.NetworkMode, network)
      assert.equal(
        Object.keys(container.HostConfig.PortBindings || {}).length,
        0
      )
      assert.ok(container.HostConfig.CapDrop.includes('ALL'))
      assert.ok(container.HostConfig.Memory > 0)
      assert.equal(
        container.Mounts.every((m) => m.Type === 'volume'),
        true
      )
      assert.equal(
        JSON.stringify(container.Args).includes('private-custom-runtime-value'),
        false
      )
      assert.equal(
        (
          await command(['exec', service.containerName, 'printenv', 'TOKEN'])
        ).stdout.trim(),
        'private-custom-runtime-value'
      )
      const app = await sails.models.app
        .findOne({ id: world.current.apps.web.id })
        .decrypt()
      assert.equal(app.secureEnvVars.HTTP_HELPER_HOST, service.internalHost)
      const peer = await command([
        'run',
        '--rm',
        '--network',
        network,
        metadata.Id,
        'wget',
        '-qO-',
        `http://${app.secureEnvVars.HTTP_HELPER_HOST}:${app.secureEnvVars.HTTP_HELPER_PORT}`
      ])
      assert.equal(peer.stdout.trim(), 'private-response')
      assert.match(
        (await command(['logs', service.containerName])).stdout,
        /custom-started/
      )
      const repeated = await browser.request.post('/api/v1/services/custom', {
        reviewId
      })
      assert.equal(repeated.data.service.id, service.id)
      assert.equal((await custom.inspectContainer(service)).Id, container.Id)
      assert.equal(
        (await browser.request.post(`/api/v1/services/${service.id}/stop`, {}))
          .status,
        200
      )
      assert.equal(
        (await custom.inspectContainer(service)).State.Running,
        false
      )
      assert.equal(
        (
          await browser.request.post(
            `/api/v1/services/${service.id}/restart`,
            {}
          )
        ).status,
        200
      )
      await command(['rm', '-f', service.containerName])
      await custom.start(service)
      assert.equal(
        (
          await command(['exec', service.containerName, 'cat', '/data/value'])
        ).stdout.trim(),
        'retained'
      )
      assert.equal((await custom.inspectContainer(service)).Image, metadata.Id)
      const bad = await create('unhealthy', { healthCommand: ['false'] })
      assert.equal(bad.service.customState.health, 'unhealthy')
      const plain = await create('unverified', {
        volumes: [],
        command: ['sh', '-c', 'while :; do sleep 1; done']
      })
      assert.equal(plain.service.customState.health, 'unverified')
      const cleanup = await sails.helpers.cleanup.run.with({
        targetKey: `service:${service.id}`,
        requestKey: `service:${service.id}`,
        scopeType: 'service',
        resourceId: service.id,
        retentionPolicy: 'retain',
        userId: world.current.users.genesisUser.id,
        teamId: world.current.teams.genesisTeam.id
      })
      assert.equal(cleanup.status, 'complete')
      assert.equal(await custom.inspectContainer(service), null)
      assert.ok(
        JSON.parse(
          (
            await command([
              'volume',
              'inspect',
              service.customState.volumes[0].name
            ])
          ).stdout
        )[0]
      )
      const unlinked = await sails.models.app
        .findOne({ id: world.current.apps.web.id })
        .decrypt()
      assert.equal(unlinked.secureEnvVars.HTTP_HELPER_HOST, undefined)
      const purged = await sails.helpers.cleanup.run.with({
        targetKey: `service:${bad.service.id}`,
        requestKey: `service:${bad.service.id}`,
        scopeType: 'service',
        resourceId: bad.service.id,
        retentionPolicy: 'purge',
        userId: world.current.users.genesisUser.id,
        teamId: world.current.teams.genesisTeam.id
      })
      assert.equal(purged.status, 'complete')
      await assert.rejects(() =>
        command(['volume', 'inspect', bad.service.customState.volumes[0].name])
      )
      // A foreign container at a saved name must never be stopped or removed.
      await command(['rm', '-f', plain.service.containerName])
      await command([
        'create',
        '--name',
        plain.service.containerName,
        metadata.Id,
        'sleep',
        '60'
      ])
      await assert.rejects(
        () => custom.start(plain.service),
        /belongs to another resource/
      )
      assert.ok(
        JSON.parse(
          (await command(['inspect', plain.service.containerName])).stdout
        )[0]
      )
    } finally {
      custom.inspectImage = originalInspect
      sails.config.custom.slipwayNetwork = originalNetwork
      for (const service of resources) {
        await command(['rm', '-f', service.containerName]).catch(() => {})
        for (const volume of service.customState.volumes)
          await command(['volume', 'rm', volume.name]).catch(() => {})
      }
      if (madeNetwork) await command(['network', 'rm', network]).catch(() => {})
    }
  }
)
