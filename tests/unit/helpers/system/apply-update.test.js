const { test } = require('sounding')

const applyUpdate = require('../../../../api/helpers/system/apply-update')

const { buildRunArgs, hasMountDestination } = applyUpdate._private

test('buildRunArgs injects the Slipway apps bind mount when it is missing', async ({ expect }) => {
  const containerInfo = {
    Mounts: [
      {
        Type: 'volume',
        Name: 'slipway-db',
        Destination: '/app/db',
      },
    ],
    NetworkSettings: {
      Networks: {
        slipway: {},
      },
    },
    HostConfig: {
      PortBindings: {
        '1337/tcp': [{ HostPort: '1337' }],
      },
    },
    Config: {
      Env: ['NODE_ENV=production'],
      Labels: {},
    },
  }

  const args = buildRunArgs(containerInfo, {
    extraMounts: [
      {
        type: 'bind',
        source: '/var/slipway/apps',
        destination: '/var/slipway/apps',
      },
    ],
  })

  expect(args.includes('--network')).toBe(true)
  expect(args.includes('slipway')).toBe(true)
  expect(args.includes('-v')).toBe(true)
  expect(args.includes('/app/db')).toBe(false)
  expect(args.includes('slipway-db:/app/db')).toBe(true)
  expect(args.includes('/var/slipway/apps:/var/slipway/apps')).toBe(true)
  expect(args.includes('-p')).toBe(true)
  expect(args.includes('1337:1337')).toBe(true)
})

test('buildRunArgs does not duplicate the apps bind mount when it already exists', async ({ expect }) => {
  const containerInfo = {
    Mounts: [
      {
        Type: 'bind',
        Source: '/var/slipway/apps',
        Destination: '/var/slipway/apps',
        RW: true,
      },
    ],
    NetworkSettings: {
      Networks: {},
    },
    HostConfig: {
      PortBindings: {},
    },
    Config: {
      Env: [],
      Labels: {},
    },
  }

  const args = buildRunArgs(containerInfo, {
    extraMounts: [
      {
        type: 'bind',
        source: '/var/slipway/apps',
        destination: '/var/slipway/apps',
      },
    ],
  })

  expect(
    args.filter((value) => value === '/var/slipway/apps:/var/slipway/apps').length
  ).toBe(1)
  expect(hasMountDestination(containerInfo, '/var/slipway/apps')).toBe(true)
})
