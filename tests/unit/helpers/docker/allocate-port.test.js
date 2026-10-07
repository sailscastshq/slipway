const net = require('node:net')
const assert = require('node:assert/strict')

const { test } = require('sounding')

test('docker port allocation reserves ports atomically for concurrent deploys', async ({
  sails,
  expect
}) => {
  const originalDiscovery = sails.helpers.docker.listPublishedPorts
  sails.helpers.docker.listPublishedPorts = async () => []
  const previousRange = sails.config.custom.slipwayPortRange
  const previousHost = sails.config.custom.slipwayPortHost
  const start = await findFreePortBlock(2)

  sails.config.custom.slipwayPortRange = { start, end: start + 1 }
  sails.config.custom.slipwayPortHost = '127.0.0.1'

  try {
    const ports = await Promise.all([
      sails.helpers.docker.allocatePort.with({
        ownerType: 'deployment',
        ownerId: 'deployment-1'
      }),
      sails.helpers.docker.allocatePort.with({
        ownerType: 'deployment',
        ownerId: 'deployment-2'
      })
    ])

    expect(new Set(ports).size).toBe(2)
    expect(ports.sort()).toEqual([start, start + 1])

    const reservations = await PortReservation.find({
      host: '127.0.0.1'
    }).sort('port ASC')

    expect(reservations.map((reservation) => reservation.port)).toEqual([
      start,
      start + 1
    ])
  } finally {
    await PortReservation.destroy({ host: '127.0.0.1' })
    sails.helpers.docker.listPublishedPorts = originalDiscovery
    sails.config.custom.slipwayPortRange = previousRange
    sails.config.custom.slipwayPortHost = previousHost
  }
})

test('docker port allocation skips ports already bound on the host', async ({
  sails,
  expect
}) => {
  const originalDiscovery = sails.helpers.docker.listPublishedPorts
  sails.helpers.docker.listPublishedPorts = async () => []
  const previousRange = sails.config.custom.slipwayPortRange
  const previousHost = sails.config.custom.slipwayPortHost
  const start = await findFreePortBlock(2)
  const server = net.createServer()

  sails.config.custom.slipwayPortRange = { start, end: start + 1 }
  sails.config.custom.slipwayPortHost = '127.0.0.1'

  try {
    await listen(server, start)

    const port = await sails.helpers.docker.allocatePort.with({
      ownerType: 'deployment',
      ownerId: 'deployment-host-check'
    })

    expect(port).toBe(start + 1)
  } finally {
    await close(server)
    await PortReservation.destroy({ host: '127.0.0.1' })
    sails.helpers.docker.listPublishedPorts = originalDiscovery
    sails.config.custom.slipwayPortRange = previousRange
    sails.config.custom.slipwayPortHost = previousHost
  }
})

test('docker port reservations can be released and recycled after failure', async ({
  sails,
  expect
}) => {
  const originalDiscovery = sails.helpers.docker.listPublishedPorts
  sails.helpers.docker.listPublishedPorts = async () => []
  const previousRange = sails.config.custom.slipwayPortRange
  const previousHost = sails.config.custom.slipwayPortHost
  const start = await findFreePortBlock(1)

  sails.config.custom.slipwayPortRange = { start, end: start }
  sails.config.custom.slipwayPortHost = '127.0.0.1'

  try {
    const firstPort = await sails.helpers.docker.allocatePort.with({
      ownerType: 'deployment',
      ownerId: 'failed-deployment'
    })

    const release = await sails.helpers.docker.releasePort.with({
      hostPort: firstPort,
      ownerType: 'deployment',
      ownerId: 'failed-deployment'
    })

    const secondPort = await sails.helpers.docker.allocatePort.with({
      ownerType: 'deployment',
      ownerId: 'retry-deployment'
    })

    expect(firstPort).toBe(start)
    expect(release.released).toBe(1)
    expect(secondPort).toBe(start)
  } finally {
    await PortReservation.destroy({ host: '127.0.0.1' })
    sails.helpers.docker.listPublishedPorts = originalDiscovery
    sails.config.custom.slipwayPortRange = previousRange
    sails.config.custom.slipwayPortHost = previousHost
  }
})

test('Docker host bindings absent from app records are excluded before reservation', async ({
  sails,
  expect
}) => {
  const originalDiscovery = sails.helpers.docker.listPublishedPorts
  const previousRange = sails.config.custom.slipwayPortRange
  const start = await findFreePortBlock(2)
  sails.config.custom.slipwayPortRange = { start, end: start + 1 }
  sails.helpers.docker.listPublishedPorts = async () => [start]
  try {
    const port = await sails.helpers.docker.allocatePort.with({
      host: '127.0.0.1',
      ownerId: 'docker-host-binding'
    })
    expect(port).toBe(start + 1)
    expect(await PortReservation.count({ port: start })).toBe(0)
  } finally {
    await PortReservation.destroy({ ownerId: 'docker-host-binding' })
    sails.helpers.docker.listPublishedPorts = originalDiscovery
    sails.config.custom.slipwayPortRange = previousRange
  }
})

test('failed Docker host discovery reserves nothing and keeps existing reservations', async ({
  sails,
  expect
}) => {
  const originalDiscovery = sails.helpers.docker.listPublishedPorts
  const start = await findFreePortBlock(1)
  await PortReservation.create({
    reservationKey: `127.0.0.1:${start}`,
    host: '127.0.0.1',
    port: start,
    expiresAt: Date.now() - 1000,
    ownerId: 'discovery-failure'
  })
  sails.helpers.docker.listPublishedPorts = async () => {
    throw new Error('Docker daemon unavailable')
  }
  try {
    await assert.rejects(
      sails.helpers.docker.allocatePort.with({}),
      /Docker daemon unavailable/
    )
    expect(await PortReservation.count()).toBe(1)
  } finally {
    await PortReservation.destroy({ ownerId: 'discovery-failure' })
    sails.helpers.docker.listPublishedPorts = originalDiscovery
  }
})

test('Docker bindings parse wildcard, loopback, IPv6 and ranges while ignoring unpublished ports and UDP', async ({
  expect
}) => {
  const { parsePublishedPorts } =
    require('../../../../api/helpers/docker/list-published-ports')._private
  const response = [
    '0.0.0.0:1342->1337/tcp, [::]:1342->1337/tcp, 1337/tcp',
    '127.0.0.1:1343-1345->8000-8002/tcp, :::1346->80/tcp',
    '[::1]:1347->80/tcp, 0.0.0.0:1348->53/udp, 9000-9002/tcp',
    ''
  ]
    .map(JSON.stringify)
    .join('\n')
  expect(parsePublishedPorts(response)).toEqual([
    1342, 1343, 1344, 1345, 1346, 1347
  ])
  expect(parsePublishedPorts('')).toEqual([])
  for (const malformed of [
    'not json',
    '{}',
    JSON.stringify('127.0.0.1:0->80/tcp'),
    JSON.stringify('127.0.0.1:65536->80/tcp'),
    JSON.stringify('127.0.0.1:1342-1341->80/tcp'),
    JSON.stringify('127.0.0.1:1342-1344->80/tcp'),
    JSON.stringify('unknown:1342->80/tcp'),
    JSON.stringify('127.0.0.1:1342->80/unknown')
  ]) {
    assert.throws(() => parsePublishedPorts(malformed))
  }
})

test('Docker command failure gives an actionable allocation error without reserving a port', async ({
  sails,
  expect
}) => {
  const previousDocker = sails.config.docker
  sails.config.docker = {
    ...previousDocker,
    binaryPath: '/slipway-port-proof/missing-docker'
  }
  try {
    await assert.rejects(
      sails.helpers.docker.allocatePort.with({}),
      /Verify Docker daemon access and retry; no port was reserved/
    )
    expect(await PortReservation.count()).toBe(0)
  } finally {
    sails.config.docker = previousDocker
  }
})

async function findFreePortBlock(size) {
  for (let start = 30000; start < 65000 - size; start++) {
    let available = true

    for (let offset = 0; offset < size; offset++) {
      if (!(await canListen(start + offset))) {
        available = false
        break
      }
    }

    if (available) {
      return start
    }
  }

  throw new Error(`Could not find ${size} available host ports`)
}

function canListen(port) {
  const server = net.createServer()

  return new Promise((resolve) => {
    server.once('error', () => {
      resolve(false)
    })

    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server) {
  if (!server.listening) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}
