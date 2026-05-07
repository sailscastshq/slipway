const net = require('node:net')

const { test } = require('sounding')

test('docker port allocation reserves ports atomically for concurrent deploys', async ({
  sails,
  expect
}) => {
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
    sails.config.custom.slipwayPortRange = previousRange
    sails.config.custom.slipwayPortHost = previousHost
  }
})

test('docker port allocation skips ports already bound on the host', async ({
  sails,
  expect
}) => {
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
    sails.config.custom.slipwayPortRange = previousRange
    sails.config.custom.slipwayPortHost = previousHost
  }
})

test('docker port reservations can be released and recycled after failure', async ({
  sails,
  expect
}) => {
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
    sails.config.custom.slipwayPortRange = previousRange
    sails.config.custom.slipwayPortHost = previousHost
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
