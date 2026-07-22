const childProcess = require('node:child_process')
const path = require('node:path')
const { promisify } = require('node:util')

const { test } = require('sounding')

const helperPath = path.resolve(
  __dirname,
  '../../../../api/helpers/caddy/update-route.js'
)

function routeWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: {
        slug,
        name: 'Transactional Route'
      }
    }
  }
}

test(
  'an empty app snapshot removes the environment route',
  { world: routeWorld('empty-route-removal') },
  async ({ world, expect }) => {
    const calls = []
    const helper = loadHelperWithExec(async (dockerPath, args) => {
      calls.push({ dockerPath, args })
      return { stdout: '', stderr: '' }
    })

    const result = await helper.fn({
      environmentId: world.current.environments.production.id,
      apps: []
    })

    expect(result.action).toBe('removed')
    expect(calls.map(({ args }) => args)).toEqual([
      ['rm', '-f', result.routeId]
    ])
  }
)

test(
  'candidate route verification failure removes the candidate and verifies the still-active previous route',
  { world: routeWorld('route-restoration') },
  async ({ sails, world, expect }) => {
    const environment = world.current.environments.production
    const currentApp = await sails.models.app
      .updateOne({ id: world.current.apps.web.id })
      .set({
        status: 'running',
        containerId: 'previous-container-id',
        containerName: 'slipway-route-restoration-previous',
        port: 1337,
        hostPort: 1410,
        routePath: '/'
      })
    const routeContainerName = `slipway-route-${world.current.projects.deploymentTarget.slug}-${environment.slug}`
    const candidateName = `${routeContainerName}-candidate-deployment-123`
    const calls = []
    const oldRunning = true
    const helper = loadHelperWithExec(async (dockerPath, args) => {
      calls.push({ dockerPath, args })

      if (args[0] === 'inspect') {
        return { stdout: `${oldRunning}\n`, stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const originalVerifyRoute = sails.helpers.caddy.verifyRoute
    const originalLogError = sails.log.error
    let verificationCount = 0
    sails.log.error = () => {}
    sails.helpers.caddy.verifyRoute = machineStub(async () => {
      verificationCount += 1
      if (verificationCount === 1) {
        const error = new Error('Candidate-only route was rejected')
        error.code = 'CADDY_ROUTE_VERIFICATION_FAILED'
        throw error
      }
      return { expectedUpstreams: [] }
    })

    try {
      const error = await captureError(
        helper.fn({
          environmentId: environment.id,
          routeVersion: 'deployment-123',
          deferCommit: true,
          apps: [
            {
              ...currentApp,
              containerId: 'candidate-container-id',
              containerName: 'slipway-route-restoration-candidate',
              hostPort: 1411
            }
          ]
        })
      )
      const commands = calls.map(({ args }) => args)
      const removeCandidateAfterFailure = commands.findLastIndex(
        (args) => args[0] === 'rm' && args[2] === candidateName
      )
      const persistedApp = await sails.models.app.findOne({ id: currentApp.id })

      expect(error.message).toContain('Candidate-only route was rejected')
      expect(verificationCount).toBe(2)
      expect(oldRunning).toBe(true)
      expect(removeCandidateAfterFailure > -1).toBe(true)
      expect(
        commands.some(
          (args) =>
            args[0] === 'stop' ||
            (args[0] === 'start' && args[1] === routeContainerName)
        )
      ).toBe(false)
      expect(persistedApp.containerName).toBe(
        'slipway-route-restoration-previous'
      )
    } finally {
      sails.helpers.caddy.verifyRoute = originalVerifyRoute
      sails.log.error = originalLogError
    }
  }
)

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
