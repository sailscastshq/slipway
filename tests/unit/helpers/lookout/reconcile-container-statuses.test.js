const { test } = require('sounding')
const listContainerStates = require('../../../../api/helpers/docker/list-container-states')

const { parseContainerStates } = listContainerStates._private

function managedContainersWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: {
        slug,
        name: 'Managed Containers'
      }
    }
  }
}

async function createManagedRecords({ sails, world, status = 'stopped' }) {
  const current = world.current
  const app = await sails.models.app
    .updateOne({ id: current.apps.web.id })
    .set({
      status,
      containerName: `slipway-${current.key}-web`
    })
  const service = await world.create('service').with({
    environment: current.environments.production.id,
    status,
    containerName: `slipway-${current.key}-database`
  })

  return { app, service }
}

function transitionsFor(transitions, records) {
  const targetIds = new Set(records.map((record) => record.id))
  return transitions.filter((transition) => targetIds.has(transition.id))
}

test(
  'status reconciliation restores managed apps and services observed running',
  { world: managedContainersWorld('container-status-recovery') },
  async ({ sails, world, expect }) => {
    const { app, service } = await createManagedRecords({ sails, world })

    const transitions =
      await sails.helpers.lookout.reconcileContainerStatuses.with({
        containerStates: [
          { name: app.containerName, state: 'running', running: true },
          { name: service.containerName, state: 'running', running: true }
        ]
      })

    const updatedApp = await sails.models.app.findOne({ id: app.id })
    const updatedService = await sails.models.service.findOne({
      id: service.id
    })

    expect(updatedApp.status).toBe('running')
    expect(updatedService.status).toBe('running')
    expect(transitionsFor(transitions, [app, service])).toEqual([
      {
        resourceType: 'app',
        id: app.id,
        containerName: app.containerName,
        from: 'stopped',
        to: 'running'
      },
      {
        resourceType: 'service',
        id: service.id,
        containerName: service.containerName,
        from: 'stopped',
        to: 'running'
      }
    ])
  }
)

test(
  'status reconciliation converges after a missing container returns',
  { world: managedContainersWorld('container-status-missed-sample') },
  async ({ sails, world, expect }) => {
    const { app, service } = await createManagedRecords({
      sails,
      world,
      status: 'running'
    })

    const stoppedTransitions =
      await sails.helpers.lookout.reconcileContainerStatuses.with({
        containerStates: []
      })

    expect((await sails.models.app.findOne({ id: app.id })).status).toBe(
      'stopped'
    )
    expect(
      (await sails.models.service.findOne({ id: service.id })).status
    ).toBe('stopped')
    expect(
      transitionsFor(stoppedTransitions, [app, service]).map(
        (transition) => transition.to
      )
    ).toEqual(['stopped', 'stopped'])

    const recoveredTransitions =
      await sails.helpers.lookout.reconcileContainerStatuses.with({
        containerStates: [
          { name: app.containerName, state: 'running', running: true },
          { name: service.containerName, state: 'running', running: true }
        ]
      })

    expect((await sails.models.app.findOne({ id: app.id })).status).toBe(
      'running'
    )
    expect(
      (await sails.models.service.findOne({ id: service.id })).status
    ).toBe('running')
    expect(
      transitionsFor(recoveredTransitions, [app, service]).map(
        (transition) => transition.to
      )
    ).toEqual(['running', 'running'])
  }
)

test(
  'status reconciliation preserves transitional and intentional states',
  { world: managedContainersWorld('container-status-transitions') },
  async ({ sails, world, expect }) => {
    const { app, service } = await createManagedRecords({
      sails,
      world,
      status: 'running'
    })
    await sails.models.service.updateOne({ id: service.id }).set({
      status: 'stopped'
    })

    const transitions =
      await sails.helpers.lookout.reconcileContainerStatuses.with({
        containerStates: [
          { name: app.containerName, state: 'restarting', running: false },
          { name: service.containerName, state: 'exited', running: false }
        ]
      })

    expect((await sails.models.app.findOne({ id: app.id })).status).toBe(
      'running'
    )
    expect(
      (await sails.models.service.findOne({ id: service.id })).status
    ).toBe('stopped')
    expect(transitionsFor(transitions, [app, service])).toEqual([])

    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'deploying'
    })
    const deploymentTransitions =
      await sails.helpers.lookout.reconcileContainerStatuses.with({
        containerStates: [
          { name: app.containerName, state: 'running', running: true },
          { name: service.containerName, state: 'exited', running: false }
        ]
      })

    expect((await sails.models.app.findOne({ id: app.id })).status).toBe(
      'deploying'
    )
    expect(transitionsFor(deploymentTransitions, [app, service])).toEqual([])
  }
)

test('docker stats failures remain errors instead of empty samples', async ({
  sails,
  expect
}) => {
  const originalDockerConfig = sails.config.docker
  sails.config.docker = {
    ...(originalDockerConfig || {}),
    binaryPath: '/definitely-missing-slipway-docker'
  }

  try {
    let error
    try {
      await sails.helpers.docker.getContainerStats()
    } catch (err) {
      error = err
    }

    expect(error).toBeDefined()
    expect(error.code).toBe('ENOENT')
  } finally {
    sails.config.docker = originalDockerConfig
  }
})

test(
  'Docker lifecycle observation failures leave persisted status untouched',
  { world: managedContainersWorld('container-status-observation-failure') },
  async ({ sails, world, expect }) => {
    const originalDockerConfig = sails.config.docker
    const app = await sails.models.app
      .updateOne({ id: world.current.apps.web.id })
      .set({
        status: 'running',
        containerName: `slipway-${world.current.key}-unobserved`
      })
    sails.config.docker = {
      ...(originalDockerConfig || {}),
      binaryPath: '/definitely-missing-slipway-docker'
    }

    try {
      let error
      try {
        await sails.helpers.lookout.reconcileContainerStatuses()
      } catch (err) {
        error = err
      }

      expect(error).toBeDefined()
      expect(error.code).toBe('ENOENT')
      expect((await sails.models.app.findOne({ id: app.id })).status).toBe(
        'running'
      )
    } finally {
      sails.config.docker = originalDockerConfig
    }
  }
)

test('Docker lifecycle output is normalized as a complete snapshot', async ({
  expect
}) => {
  const states = parseContainerStates(
    [
      JSON.stringify({
        ID: 'abc123',
        Names: 'slipway-web',
        State: 'running',
        Status: 'Up 2 minutes'
      }),
      JSON.stringify({
        ID: 'def456',
        Names: 'slipway-db',
        State: 'exited',
        Status: 'Exited (0) 1 minute ago'
      }),
      JSON.stringify({
        ID: 'ghi789',
        Names: 'slipway-worker',
        State: 'restarting',
        Status: 'Restarting (1) 2 seconds ago'
      })
    ].join('\n')
  )

  expect(states).toEqual([
    {
      id: 'abc123',
      name: 'slipway-web',
      state: 'running',
      running: true,
      status: 'Up 2 minutes'
    },
    {
      id: 'def456',
      name: 'slipway-db',
      state: 'exited',
      running: false,
      status: 'Exited (0) 1 minute ago'
    },
    {
      id: 'ghi789',
      name: 'slipway-worker',
      state: 'restarting',
      running: false,
      status: 'Restarting (1) 2 seconds ago'
    }
  ])
})

test('malformed Docker lifecycle output rejects the whole snapshot', async ({
  expect
}) => {
  let error
  try {
    parseContainerStates(
      `${JSON.stringify({ Names: 'slipway-web', State: 'running' })}\nnot-json`
    )
  } catch (err) {
    error = err
  }

  expect(error).toBeDefined()
  expect(error.message).toMatch(/Could not parse Docker container state/)
})
