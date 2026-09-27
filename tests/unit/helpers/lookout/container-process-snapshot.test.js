const { test } = require('sounding')
const {
  parseDockerTop
} = require('../../../../api/lib/container-process-snapshot')

test('Lookout identifies active Bridge RSS without copying process arguments', async ({
  expect
}) => {
  const snapshot = parseDockerTop(
    'PID RSS COMMAND\n' +
      '10 225280 node app.js --private-token=secret\n' +
      '42 90112 slipway-bridge-worker\n',
    12345
  )

  expect(snapshot).toEqual({
    available: true,
    observedAt: 12345,
    processCount: 2,
    bridgeWorkerCount: 1,
    bridgeWorkerRssMiB: 88
  })
  expect(JSON.stringify(snapshot).includes('secret')).toBe(false)

  const startingWorker = parseDockerTop(
    'PID RSS COMMAND\n42 90112 node -e ___SLIPWAY_BRIDGE_WORKER_RESULT___',
    12345
  )
  expect(startingWorker.bridgeWorkerCount).toBe(1)
})

test('Lookout distinguishes no Bridge worker from an unreadable process list', async ({
  expect
}) => {
  expect(parseDockerTop('PID RSS COMMAND\n10 225280 node app.js', 20)).toEqual({
    available: true,
    observedAt: 20,
    processCount: 1,
    bridgeWorkerCount: 0,
    bridgeWorkerRssMiB: 0
  })
  expect(parseDockerTop('unexpected output', 20)).toEqual({
    available: false,
    observedAt: 20
  })
  expect(
    parseDockerTop('PID RSS COMMAND\n10 not-a-number node app.js', 20)
  ).toEqual({
    available: false,
    observedAt: 20
  })
})
