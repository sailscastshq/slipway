const assert = require('node:assert/strict')
const net = require('node:net')
const allocate = require('/proof/api/helpers/docker/allocate-port')
const discovery = require('/proof/api/helpers/docker/list-published-ports')

const occupied = Number(process.argv[2])
const reservations = []
global.sails = {
  config: {
    custom: {
      slipwayPortRange: {
        start: occupied === 65535 ? occupied - 10 : occupied,
        end: Math.min(65535, occupied + 10)
      }
    }
  },
  helpers: { docker: { listPublishedPorts: () => discovery.fn() } },
  log: { debug() {}, error() {} }
}
// Empty app metadata deliberately reproduces an external binding invisible to
// Slipway's records. Real Waterline concurrency is covered by the helper suite.
global.App = { find: () => ({ select: async () => [] }) }
global.PortReservation = {
  destroy: async () => {},
  find: () => ({ select: async () => reservations }),
  create: async (record) => reservations.push(record)
}

async function run() {
  const probe = net.createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(occupied, '127.0.0.1', resolve)
  })
  await new Promise((resolve) => probe.close(resolve))
  const port = await allocate.fn({
    host: '127.0.0.1',
    checkHost: true,
    ttl: 60000,
    ownerId: 'docker-namespace-proof'
  })
  assert.notEqual(port, occupied)
  assert.equal(reservations.length, 1)
  assert.equal(reservations[0].port, port)
  console.log(
    JSON.stringify({ localProbeWouldSelect: occupied, selected: port })
  )
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
