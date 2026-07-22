const childProcess = require('node:child_process')
const path = require('node:path')
const { promisify } = require('node:util')

const { test } = require('sounding')

const helperPath = path.resolve(
  __dirname,
  '../../../../api/helpers/caddy/finish-route-update.js'
)

test('route commit failure restores and verifies the previous route', async ({
  sails,
  expect
}) => {
  const transaction = routeTransaction()
  const docker = fakeDocker({
    [transaction.routeId]: true,
    [transaction.candidateRouteId]: true
  })
  const helper = loadHelperWithExec(docker.exec)
  const originalVerifyRoute = sails.helpers.caddy.verifyRoute
  const verified = []
  sails.helpers.caddy.verifyRoute = machineStub(
    async ({ expectedUpstreams, excludedUpstreams }) => {
      verified.push({ expectedUpstreams, excludedUpstreams })
      if (verified.length === 1) {
        throw new Error('Candidate-only route was rejected')
      }
      return { expectedUpstreams }
    }
  )

  try {
    const error = await captureError(
      helper.fn({ action: 'commit', transaction })
    )

    expect(error.message).toContain('Candidate-only route was rejected')
    expect(docker.state(transaction.routeId)).toEqual({
      exists: true,
      running: true
    })
    expect(docker.state(transaction.candidateRouteId).exists).toBe(false)
    expect(verified).toEqual([
      {
        expectedUpstreams: transaction.candidateUpstreams,
        excludedUpstreams: ['slipway-web-previous:1337']
      },
      {
        expectedUpstreams: transaction.previousUpstreams,
        excludedUpstreams: ['slipway-web-candidate:1337']
      }
    ])
  } finally {
    sails.helpers.caddy.verifyRoute = originalVerifyRoute
  }
})

test('cancelling a staged route keeps the previous route running', async ({
  sails,
  expect
}) => {
  const transaction = routeTransaction()
  const docker = fakeDocker({
    [transaction.routeId]: true,
    [transaction.candidateRouteId]: true
  })
  const helper = loadHelperWithExec(docker.exec)
  const originalVerifyRoute = sails.helpers.caddy.verifyRoute
  const verified = []
  sails.helpers.caddy.verifyRoute = machineStub(
    async ({ expectedUpstreams, excludedUpstreams }) => {
      verified.push({ expectedUpstreams, excludedUpstreams })
      return { expectedUpstreams }
    }
  )

  try {
    const result = await helper.fn({ action: 'rollback', transaction })

    expect(result.action).toBe('rolled_back')
    expect(docker.state(transaction.routeId)).toEqual({
      exists: true,
      running: true
    })
    expect(docker.state(transaction.candidateRouteId).exists).toBe(false)
    expect(verified).toEqual([
      {
        expectedUpstreams: transaction.previousUpstreams,
        excludedUpstreams: ['slipway-web-candidate:1337']
      }
    ])
  } finally {
    sails.helpers.caddy.verifyRoute = originalVerifyRoute
  }
})

test('cancelling a first route verifies that the candidate was removed', async ({
  sails,
  expect
}) => {
  const transaction = {
    ...routeTransaction(),
    previousExists: false,
    previousWasRunning: false,
    previousUpstreams: []
  }
  const docker = fakeDocker({
    [transaction.candidateRouteId]: true
  })
  const helper = loadHelperWithExec(docker.exec)
  const originalVerifyRoute = sails.helpers.caddy.verifyRoute
  const verified = []
  sails.helpers.caddy.verifyRoute = machineStub(async (inputs) => {
    verified.push(inputs)
    return { expectedUpstreams: inputs.expectedUpstreams }
  })

  try {
    await helper.fn({ action: 'rollback', transaction })

    expect(docker.state(transaction.routeId).exists).toBe(false)
    expect(docker.state(transaction.candidateRouteId).exists).toBe(false)
    expect(verified).toEqual([
      {
        expectedUpstreams: [],
        excludedUpstreams: transaction.candidateUpstreams
      }
    ])
  } finally {
    sails.helpers.caddy.verifyRoute = originalVerifyRoute
  }
})

function routeTransaction() {
  return {
    routeId: 'slipway-route-project-production',
    candidateRouteId: 'slipway-route-project-production-candidate-123',
    previousRouteId: 'slipway-route-project-production-previous-123',
    previousExists: true,
    previousWasRunning: true,
    previousUpstreams: [
      'slipway-web-previous:1337',
      'slipway-api-unchanged:1337'
    ],
    candidateUpstreams: [
      'slipway-web-candidate:1337',
      'slipway-api-unchanged:1337'
    ]
  }
}

function fakeDocker(initialContainers) {
  const containers = new Map(
    Object.entries(initialContainers).map(([name, running]) => [
      name,
      { running }
    ])
  )

  return {
    exec: async (dockerPath, args) => {
      const [command, ...rest] = args

      if (command === 'inspect') {
        const container = containers.get(rest.at(-1))
        if (!container) throw new Error('No such container')
        return { stdout: `${container.running}\n`, stderr: '' }
      }

      if (command === 'stop' || command === 'start') {
        const container = containers.get(rest[0])
        if (!container) throw new Error('No such container')
        container.running = command === 'start'
      } else if (command === 'rename') {
        const [from, to] = rest
        const container = containers.get(from)
        if (!container || containers.has(to)) {
          throw new Error('Container rename failed')
        }
        containers.delete(from)
        containers.set(to, container)
      } else if (command === 'rm') {
        containers.delete(rest.at(-1))
      }

      return { stdout: '', stderr: '' }
    },
    state: (name) => {
      const container = containers.get(name)
      return container
        ? { exists: true, running: container.running }
        : { exists: false, running: false }
    }
  }
}

function loadHelperWithExec(fakeExecFile) {
  const originalExecFile = childProcess.execFile
  const stubExecFile = () => {}
  stubExecFile[promisify.custom] = fakeExecFile

  childProcess.execFile = stubExecFile
  delete require.cache[require.resolve(helperPath)]

  try {
    return require(helperPath)
  } finally {
    childProcess.execFile = originalExecFile
    delete require.cache[require.resolve(helperPath)]
  }
}

function machineStub(fn) {
  fn.with = fn
  return fn
}

async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error('Expected operation to fail.')
}
