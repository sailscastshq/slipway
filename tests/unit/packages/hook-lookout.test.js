const http = require('node:http')
const { EventEmitter } = require('node:events')
const { test } = require('sounding')
const defineSlipwayHook = require('../../../packages/hook')
const hookVersion = require('../../../packages/hook/package.json').version

test('the hook registers on startup and refreshes its connection with a bounded heartbeat', async ({
  expect
}) => {
  const requests = []
  const originalRequest = http.request
  http.request = createRequestRecorder(requests)
  const hook = defineSlipwayHook(createSails())

  try {
    await initialize(hook)
    await waitFor(() => requests.length >= 1)

    const response = {
      statusCode: 200,
      getHeader: () => null,
      end: () => {}
    }
    hook.routes.before['all /*'](
      {
        method: 'GET',
        originalUrl: '/courses',
        headers: {},
        ip: '127.0.0.1'
      },
      response,
      () => {}
    )
    response.end()
    await waitFor(() => requests.some((item) => item.body.spans.length === 1))
    await waitFor(() => requests.length >= 3)

    expect(requests[0].authorization).toBe('Bearer stk_test-token')
    expect(requests[0].body.registration).toEqual({
      appId: '7',
      deploymentId: '42',
      hookVersion,
      protocolVersion: 1,
      enabled: true,
      startedAt: requests[0].body.registration.startedAt,
      capabilities: {
        requests: true,
        exceptions: false,
        queries: false,
        quest: false,
        cache: false
      }
    })
    const eventRequest = requests.find((item) => item.body.spans.length === 1)
    expect(eventRequest.body.registration.startedAt).toBe(
      requests[0].body.registration.startedAt
    )
    expect(eventRequest.body.spans[0].name).toBe('GET /courses')
    expect(
      requests.every(
        (item) =>
          item.body.registration.startedAt ===
          requests[0].body.registration.startedAt
      )
    ).toBe(true)
  } finally {
    await teardown(hook)
    http.request = originalRequest
  }
})

function createSails() {
  return {
    config: {
      slipway: {
        identity: {},
        bridge: { enabled: false },
        bearing: { enabled: false },
        flags: { enabled: false },
        lookout: {
          enabled: true,
          telemetryUrl: 'http://127.0.0.1/api/v1/telemetry/ingest',
          telemetryToken: 'stk_test-token',
          appId: '7',
          deploymentId: '42',
          heartbeatInterval: 20,
          flushInterval: 60_000,
          batchSize: 1,
          captureExceptions: false,
          captureQueries: false,
          captureQuestEvents: false,
          captureCache: false
        }
      }
    },
    hooks: { helpers: { furnishHelper: () => {} } },
    helpers: {},
    log: { verbose: () => {}, info: () => {}, warn: () => {} },
    after(event, callback) {
      if (event === 'hook:helpers:loaded') callback()
    },
    on: () => {},
    models: {}
  }
}

function createRequestRecorder(requests) {
  return function recordRequest(options) {
    const request = new EventEmitter()
    let body = ''
    request.write = (chunk) => {
      body += chunk
    }
    request.end = () => {
      requests.push({
        authorization: options.headers.Authorization,
        body: JSON.parse(body)
      })
    }
    request.destroy = () => {}
    return request
  }
}

function initialize(hook) {
  return new Promise((resolve, reject) => {
    hook.initialize((error) => (error ? reject(error) : resolve()))
  })
}

function teardown(hook) {
  return new Promise((resolve) => hook.teardown(resolve))
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('Telemetry heartbeat timed out.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
