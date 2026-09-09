const { test } = require('sounding')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const custom = require('../../api/lib/custom-service')
const updates = require('../../api/lib/custom-service-update')
test(
  'real stateless candidates preserve traffic and app links, reject unhealthy/persistent updates, recover interruption and revert configuration',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'update-docker' } }
    }
  },
  async ({ sails, world }) => {
    const network = 'slipway-update-' + crypto.randomBytes(6).toString('hex')
    const containerName = network + '-service'
    const originalNetwork = sails.config.custom.slipwayNetwork,
      originalImage = custom.inspectImage,
      run = custom.command
    let made = false,
      service
    try {
      const image = JSON.parse(
        (await run(['image', 'inspect', 'node:22-alpine'])).stdout
      )[0]
      custom.inspectImage = async () => image
      await run(['network', 'create', network])
      made = true
      sails.config.custom.slipwayNetwork = network
      const definition = custom.validate({
        image: 'node:22-alpine',
        name: 'http',
        port: 8080,
        env: { MESSAGE: 'before' },
        command: [
          'node',
          '-e',
          "require('http').createServer((req,res)=>res.end(process.env.MESSAGE)).listen(8080,'0.0.0.0')"
        ],
        healthCommand: [
          'wget',
          '-q',
          '-O',
          '/dev/null',
          'http://127.0.0.1:8080'
        ]
      })
      service = await world.create('service').with({
        id: crypto.randomInt(100000000, 900000000),
        type: 'custom',
        name: 'http',
        version: definition.image,
        status: 'creating',
        containerName,
        internalHost: containerName,
        internalPort: 8080,
        imageReference: image.Id,
        customDefinition: definition,
        environment: world.current.environments.production.id,
        customState: {
          image: definition.image,
          volumes: [],
          linkPrefix: 'HTTP',
          appIds: []
        }
      })
      await custom.start({ ...service, customDefinition: definition })
      const current = () =>
        sails.models.service.findOne({ id: service.id }).decrypt()
      const actor = {
        user: world.current.users.genesisUser,
        project: world.current.projects.deploymentTarget,
        environment: world.current.environments.production
      }
      await require('../../api/lib/with-datastore-transaction')((db) =>
        custom.links(service, [String(world.current.apps.web.id)], db)
      )
      const review = async (changes, revert = false) => {
        const result = await updates.review(
          await current(),
          actor,
          changes,
          revert
        )
        return sails.models.customservicereview
          .findOne({ token: result.id })
          .decrypt()
      }
      const traffic = async () =>
        (
          await run([
            'run',
            '--rm',
            '--network',
            network,
            image.Id,
            'node',
            '-e',
            `require('http').get('http://${containerName}:8080',r=>r.pipe(process.stdout)).on('error',()=>process.exit(1))`
          ])
        ).stdout
      assert.equal(await traffic(), 'before')
      const first = await review({ env: { MESSAGE: 'after' } })
      await updates.apply(first, actor)
      assert.equal(await traffic(), 'after')
      let saved = await current()
      const afterId = saved.containerId
      assert.equal((await custom.inspectContainer(saved)).Mounts.length, 0)
      assert.equal(
        Object.keys(
          (await custom.inspectContainer(saved)).HostConfig.PortBindings || {}
        ).length,
        0
      )
      const app = await sails.models.app
        .findOne({ id: world.current.apps.web.id })
        .decrypt()
      assert.equal(app.secureEnvVars.HTTP_HOST, containerName)
      const unhealthy = await review({
        env: { MESSAGE: 'bad' },
        healthCommand: ['false']
      })
      await assert.rejects(updates.apply(unhealthy, actor))
      assert.equal(await traffic(), 'after')
      assert.equal((await current()).containerId, afterId)
      let failCutover = true,
        failRecovery = true
      custom.command = async (args, timeout) => {
        if (
          failCutover &&
          args[0] === 'rename' &&
          args[1].includes('-candidate-')
        ) {
          await run(args, timeout)
          throw Error('simulated interruption after rename')
        }
        if (
          failRecovery &&
          args[0] === 'rename' &&
          args[1].includes('-previous-')
        )
          throw Error('simulated unavailable Docker')
        return run(args, timeout)
      }
      const interrupted = await review({ env: { MESSAGE: 'interrupted' } })
      await assert.rejects(updates.apply(interrupted, actor))
      saved = await current()
      assert.ok(saved.customState.update)
      assert.equal(saved.status, 'failed')
      await assert.rejects(updates.review(saved, actor, {}))
      failCutover = false
      failRecovery = false
      await updates.recover(await current(), actor)
      assert.equal(await traffic(), 'after')
      const back = await review({}, true)
      await updates.apply(back, actor)
      assert.equal(await traffic(), 'before')
      const next = await review({ env: { MESSAGE: 'concurrent' } })
      const concurrent = await Promise.allSettled([
        updates.apply(next, actor),
        updates.apply(next, actor)
      ])
      assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1)
      assert.equal(await traffic(), 'concurrent')
      const snapshot = await sails.helpers.cleanup.createSnapshot.with({
        scopeType: 'service',
        resourceId: String(service.id)
      })
      for (const name of (await current()).customState.retainedContainers)
        assert.ok(snapshot.artifacts.containerNames.includes(name))
      image.Config.Volumes = { '/data': {} }
      await assert.rejects(
        updates.review(await current(), actor, {}),
        /persistent/
      )
    } finally {
      custom.command = run
      custom.inspectImage = originalImage
      sails.config.custom.slipwayNetwork = originalNetwork
      if (made) {
        const ids = (
          await run(['ps', '-aq', '--filter', `network=${network}`])
        ).stdout
          .trim()
          .split('\n')
          .filter(Boolean)
        if (service) {
          const owned = (
            await run(['ps', '-aq', '--filter', `name=^/${containerName}`])
          ).stdout
            .trim()
            .split('\n')
            .filter(Boolean)
          ids.push(...owned)
        }
        if (ids.length) await run(['rm', '-f', ...new Set(ids)])
        await run(['network', 'rm', network])
      }
    }
  }
)
