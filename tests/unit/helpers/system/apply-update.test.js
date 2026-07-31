const vm = require('node:vm')

const { test } = require('sounding')

test('self-update docker args include the persistent apps mount when it is missing', async ({
  sails,
  expect
}) => {
  const containerInfo = {
    Mounts: [
      {
        Type: 'volume',
        Name: 'slipway-db',
        Destination: '/app/db'
      }
    ],
    NetworkSettings: {
      Networks: {
        slipway: {}
      }
    },
    HostConfig: {
      PortBindings: {
        '1337/tcp': [{ HostPort: '1337' }]
      }
    },
    Config: {
      Env: ['NODE_ENV=production'],
      Labels: {}
    }
  }

  const { runArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo,
    extraMounts: [
      {
        type: 'bind',
        source: '/var/slipway/apps',
        destination: '/var/slipway/apps'
      }
    ]
  })

  expect(runArgs.includes('--network')).toBe(true)
  expect(runArgs.includes('slipway')).toBe(true)
  expect(runArgs.includes('-v')).toBe(true)
  expect(runArgs.includes('/app/db')).toBe(false)
  expect(runArgs.includes('slipway-db:/app/db')).toBe(true)
  expect(runArgs.includes('/var/slipway/apps:/var/slipway/apps')).toBe(true)
  expect(runArgs.includes('-p')).toBe(true)
  expect(runArgs.includes('1337:1337')).toBe(true)
})

test('self-update docker args keep an existing apps mount without duplicating it', async ({
  sails,
  expect
}) => {
  const containerInfo = {
    Mounts: [
      {
        Type: 'bind',
        Source: '/var/slipway/apps',
        Destination: '/var/slipway/apps',
        RW: true
      }
    ],
    NetworkSettings: {
      Networks: {}
    },
    HostConfig: {
      PortBindings: {}
    },
    Config: {
      Env: [],
      Labels: {}
    }
  }

  const { runArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo,
    extraMounts: [
      {
        type: 'bind',
        source: '/var/slipway/apps',
        destination: '/var/slipway/apps'
      }
    ]
  })

  expect(
    runArgs.filter((value) => value === '/var/slipway/apps:/var/slipway/apps')
      .length
  ).toBe(1)
})

test('self-update preserves loopback-only dashboard port bindings', async ({
  sails,
  expect
}) => {
  const { runArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo: {
      Mounts: [],
      NetworkSettings: { Networks: {} },
      HostConfig: {
        PortBindings: {
          '1337/tcp': [{ HostIp: '127.0.0.1', HostPort: '1337' }]
        }
      },
      Config: { Env: [], Labels: {} }
    }
  })

  expect(runArgs.includes('127.0.0.1:1337:1337')).toBe(true)
  expect(runArgs.includes('1337:1337')).toBe(false)
})

test('self-update collapses equivalent public IPv4 and IPv6 bindings', async ({
  sails,
  expect
}) => {
  const { runArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo: {
      Mounts: [],
      NetworkSettings: { Networks: {} },
      HostConfig: {
        PortBindings: {
          '1337/tcp': [
            { HostIp: '0.0.0.0', HostPort: '1337' },
            { HostIp: '::', HostPort: '1337' }
          ]
        }
      },
      Config: { Env: [], Labels: {} }
    }
  })

  expect(runArgs.filter((value) => value === '1337:1337').length).toBe(1)
})

test('self-update docker args force production node environment', async ({
  sails,
  expect
}) => {
  const { runArgs, envArgs } =
    await sails.helpers.system.buildUpdateDockerArgs.with({
      containerInfo: {
        Mounts: [],
        NetworkSettings: { Networks: {} },
        HostConfig: { PortBindings: {} },
        Config: {
          Env: ['NODE_ENV=development', 'PORT=1337', 'SLIPWAY_URL=https://x'],
          Labels: {}
        }
      }
    })

  expect(envArgs.includes('NODE_ENV=development')).toBe(false)
  expect(envArgs.includes('NODE_ENV=production')).toBe(true)
  expect(runArgs.includes('NODE_ENV=development')).toBe(false)
  expect(runArgs.includes('NODE_ENV=production')).toBe(true)
  expect(runArgs.includes('PORT=1337')).toBe(true)
  expect(runArgs.includes('SLIPWAY_URL=https://x')).toBe(true)
  expect(runArgs.includes('SLIPWAY_APP_PORT_HOST=0.0.0.0')).toBe(true)
})

test('self-update keeps an explicit private app binding', async ({
  sails,
  expect
}) => {
  const { envArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo: {
      Mounts: [],
      NetworkSettings: { Networks: {} },
      HostConfig: { PortBindings: {} },
      Config: {
        Env: ['SLIPWAY_APP_PORT_HOST=127.0.0.1'],
        Labels: {}
      }
    }
  })

  expect(envArgs.includes('SLIPWAY_APP_PORT_HOST=127.0.0.1')).toBe(true)
  expect(envArgs.includes('SLIPWAY_APP_PORT_HOST=0.0.0.0')).toBe(false)
})

test('self-update image refs use the advertised release tag instead of latest', async ({
  sails,
  expect
}) => {
  const imageRef = await sails.helpers.system.getUpdateImageRef.with({
    updateInfo: { latestVersion: 'v0.0.50' },
    imageRepository: 'ghcr.io/sailscastshq/slipway'
  })

  expect(imageRef).toBe('ghcr.io/sailscastshq/slipway:0.0.50')
  expect(imageRef.includes(':latest')).toBe(false)
})

test('self-update swap keeps the previous container available for rollback', async ({
  sails,
  expect
}) => {
  const targetImage = 'ghcr.io/sailscastshq/slipway:test-target'
  const script = await sails.helpers.system.buildUpdateSwapScript.with({
    runArgs: ['run', '-d', '--name', 'slipway', targetImage]
  })

  expect(script.includes(targetImage)).toBe(true)
  expect(script.includes('docker(["rename", containerName, backupName])')).toBe(
    true
  )
  expect(script.includes('docker(["stop", backupName])')).toBe(true)
  expect(script.includes('tryDocker(["rm", "-f", containerName])')).toBe(true)
  expect(script.includes('docker(["rename", backupName, containerName])')).toBe(
    true
  )
  expect(script.includes('waitForHealth()')).toBe(true)
  expect(script.includes('Rollback complete')).toBe(true)
  expect((script.match(/docker\(runArgs\)/g) || []).length).toBe(1)

  let syntaxError
  try {
    new vm.Script(script)
  } catch (error) {
    syntaxError = error
  }
  expect(syntaxError).toBe(undefined)
})
