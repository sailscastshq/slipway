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

test('Cloudflare Tunnel routes keep TLS at the edge', async ({
  sails,
  expect
}) => {
  const originalIngress = sails.config.custom.slipwayIngress
  const originalGetSetting = sails.helpers.setting.get

  try {
    sails.config.custom.slipwayIngress = 'cloudflare-tunnel'
    sails.helpers.setting.get = async () => 'ops@example.com'

    const helper = require(helperPath)
    const args = await helper._private.buildCreateArgs({
      candidateName: 'slipway-route-candidate',
      network: 'slipway',
      config: { domains: ['app.example.com'] },
      routableApps: [
        {
          routePath: '/',
          containerName: 'slipway-app',
          port: 1337
        }
      ]
    })

    expect(args.includes('caddy=http://app.example.com')).toBe(true)
    expect(args.some((value) => value.startsWith('caddy.tls='))).toBe(false)
  } finally {
    sails.config.custom.slipwayIngress = originalIngress
    sails.helpers.setting.get = originalGetSetting
  }
})

test('Bridge routes stay on the app origin and precede the app catch-all', ({
  expect
}) => {
  const helper = require(helperPath)
  const labels = helper._private.buildRouteLabels({
    projectSlug: 'durable-ui',
    environmentSlug: 'production',
    controlPlaneUpstream: 'slipway:1337',
    routableApps: [
      {
        slug: 'admin',
        routePath: '/admin',
        bridgeEnabled: true,
        containerName: 'durable-ui-admin',
        port: 1337
      },
      {
        slug: 'web',
        routePath: '/',
        bridgeEnabled: false,
        containerName: 'durable-ui-web',
        port: 1337
      }
    ]
  })

  expect(labels).toEqual([
    'caddy.handle_0=/admin/bridge/launch',
    'caddy.handle_0.0_uri=replace /admin/bridge/launch /bridge/launch',
    'caddy.handle_0.1_reverse_proxy=slipway:1337',
    'caddy.handle_1=/admin/bridge/_assets/*',
    'caddy.handle_1.0_uri=strip_prefix /admin/bridge/_assets',
    'caddy.handle_1.1_reverse_proxy=slipway:1337',
    'caddy.handle_2=/admin/bridge*',
    'caddy.handle_2.0_uri=replace /admin/bridge /projects/durable-ui/environments/production/apps/admin/bridge',
    'caddy.handle_2.1_reverse_proxy=slipway:1337',
    'caddy.handle_3=/admin*',
    'caddy.handle_3.0_uri=strip_prefix /admin',
    'caddy.handle_3.1_reverse_proxy=durable-ui-admin:1337',
    'caddy.handle_4=/*',
    'caddy.handle_4.1_reverse_proxy=durable-ui-web:1337'
  ])
  expect(
    helper._private.routeUpstreams(
      [
        {
          bridgeEnabled: true,
          containerName: 'durable-ui-admin',
          port: 1337
        }
      ],
      'slipway:1337'
    )
  ).toEqual(['durable-ui-admin:1337', 'slipway:1337'])
})

test('Bearing sends identity to the app before proxying its public surfaces', ({
  expect
}) => {
  const helper = require(helperPath)
  const labels = helper._private.buildRouteLabels({
    projectSlug: 'durable-ui',
    environmentSlug: 'production',
    controlPlaneUpstream: 'slipway:1337',
    routableApps: [
      {
        slug: 'admin',
        routePath: '/admin',
        bearingEnabled: true,
        bridgeEnabled: false,
        containerName: 'durable-ui-admin',
        port: 1337
      }
    ]
  })

  expect(labels.slice(0, 9)).toEqual([
    'caddy.handle_0=/admin/_slipway/bearing/socket.io*',
    'caddy.handle_0.0_uri=strip_prefix /admin/_slipway/bearing',
    'caddy.handle_0.1_reverse_proxy=slipway:1337',
    'caddy.handle_1=/admin/_slipway/bearing/identity',
    'caddy.handle_1.0_uri=strip_prefix /admin',
    'caddy.handle_1.1_reverse_proxy=durable-ui-admin:1337',
    'caddy.handle_2=/admin/_slipway/bearing/session',
    'caddy.handle_2.0_uri=replace /admin/_slipway/bearing/session /bearing/session',
    'caddy.handle_2.1_reverse_proxy=slipway:1337'
  ])
  expect(labels).toContain(
    'caddy.handle_5=/admin/_slipway/bearing/widget-config'
  )
  expect(labels).toContain(
    'caddy.handle_5.0_uri=replace /admin/_slipway/bearing/widget-config /bearing/public/durable-ui/production/admin/widget-config'
  )
  expect(labels).toContain('caddy.handle_6=/admin/feedback*')
  expect(labels).toContain(
    'caddy.handle_6.0_uri=replace /admin/feedback /bearing/public/durable-ui/production/admin/feedback'
  )
  expect(labels).toContain('caddy.handle_9=/admin*')
  expect(
    labels.indexOf('caddy.handle_1=/admin/_slipway/bearing/identity')
  ).toBe(3)
  expect(
    labels.indexOf('caddy.handle_9=/admin*') >
      labels.indexOf('caddy.handle_8=/admin/updates*')
  ).toBe(true)
  expect(
    helper._private.routeUpstreams(
      [
        {
          bearingEnabled: true,
          containerName: 'durable-ui-admin',
          port: 1337
        }
      ],
      'slipway:1337'
    )
  ).toEqual(['durable-ui-admin:1337', 'slipway:1337'])
})

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
