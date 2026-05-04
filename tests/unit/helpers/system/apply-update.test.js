const { test } = require('sounding')

test('buildUpdateDockerArgs injects the Slipway apps bind mount when it is missing', async ({
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

test('buildUpdateDockerArgs does not duplicate the apps bind mount when it already exists', async ({
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

test('getUpdateImageRef pins updates to the advertised release version', async ({
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
