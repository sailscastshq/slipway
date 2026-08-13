const { test } = require('sounding')

test(
  'deployment log appends persist every concurrent chunk with occurrence times',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'persist-deployment-logs' }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      environment: current.environments.production.id,
      app: current.apps.web.id,
      buildLogs: 'Historical line\n'
    })

    await Promise.all([
      sails.models.deployment.appendBuildLog(deployment.id, 'First line\n'),
      sails.models.deployment.appendBuildLog(deployment.id, 'Second '),
      sails.models.deployment.appendBuildLog(deployment.id, 'line\n')
    ])

    const persisted = await sails.models.deployment.findOne({
      id: deployment.id
    })
    const lines = persisted.buildLogs.split('\n')
    expect(lines[0]).toBe('Historical line')
    expect(lines[1]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z First line$/
    )
    expect(lines[2]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z Second line$/
    )
  }
)
