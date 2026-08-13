const { test } = require('sounding')

test(
  'deployment stream emits only persisted build and deploy suffixes',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'stream-deployment-logs' } }
    }
  },
  async ({ sails, world, expect }) => {
    const current = world.current
    const buildLogs = '2026-08-13T09:10:00.000Z old build\n'
    const deployLogs = '2026-08-13T09:10:01.000Z old deploy\n'
    const deployment = await world.create('deployment').with({
      status: 'building',
      environment: current.environments.production.id,
      app: current.apps.web.id,
      buildLogs,
      deployLogs
    })
    const sent = []
    const closeCallbacks = []
    let resolveWait
    const stream = {
      send(message) {
        sent.push(message)
      },
      close() {
        for (const callback of closeCallbacks) callback()
        resolveWait()
      },
      onClose(callback) {
        closeCallbacks.push(callback)
      },
      wait() {
        return new Promise((resolve) => {
          resolveWait = resolve
        })
      }
    }
    const controller = require('../../../api/controllers/api/v1/deploy/stream-deployment')

    const result = controller.fn.call(
      { req: {}, res: { sse: () => stream } },
      {
        id: String(deployment.id),
        buildOffset: buildLogs.length,
        deployOffset: deployLogs.length
      }
    )

    await sails.models.deployment.updateOne({ id: deployment.id }).set({
      status: 'running',
      finishedAt: Date.now(),
      buildLogs: `${buildLogs}2026-08-13T09:10:02.000Z fresh build\n`,
      deployLogs: `${deployLogs}2026-08-13T09:10:03.000Z fresh deploy\n`
    })

    await result
    expect(sent.some((message) => message.source === 'build')).toBe(true)
    expect(sent.some((message) => message.source === 'deploy')).toBe(true)
    expect(sent.find((message) => message.source === 'build').output).toBe(
      '2026-08-13T09:10:02.000Z fresh build\n'
    )
    expect(sent.find((message) => message.source === 'deploy').output).toBe(
      '2026-08-13T09:10:03.000Z fresh deploy\n'
    )
  }
)
