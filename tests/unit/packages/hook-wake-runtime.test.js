const { test } = require('sounding')
const assert = require('node:assert/strict')
const http = require('node:http')
const createRuntime = require('../../../packages/hook/lib/wake-runtime')

async function fixture() {
  let hold = false
  const sockets = new Set()
  const server = http.createServer((req, res) => {
    req.resume()
    if (req.url === '/register')
      return res.end(
        JSON.stringify({
          protocol: 2,
          collectionReady: true,
          leaseMs: 120000,
          settings: {
            allowedOrigins: ['https://host.example'],
            requireConsent: false,
            mode: 'cookieless'
          }
        })
      )
    if (!hold) res.end(JSON.stringify({ accepted: 100 }))
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const runtime = createRuntime(
    { config: { slipway: {} }, log: { warn() {} } },
    {
      enabled: true,
      appId: '1',
      deploymentId: '2',
      secret: 'swk_' + 'a'.repeat(64),
      ingestUrl: `http://127.0.0.1:${server.address().port}/ingest`,
      allowTestTraffic: true
    },
    '0.0.9'
  )
  runtime.start()
  for (let i = 0; i < 100 && runtime.getStatus() !== 'collecting'; i++)
    await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(runtime.getStatus(), 'collecting')
  return {
    runtime,
    hold: () => {
      hold = true
    },
    close: async () => {
      runtime.stop()
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
function response() {
  const headers = {}
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code
      return this
    },
    getHeader: (name) => headers[name],
    setHeader: (name, value) => {
      headers[name] = value
    },
    json(value) {
      this.body = value
      return this
    }
  }
}

test('Wake bounds its queue while transport stalls and drops queued events when its lease expires', async () => {
  const target = await fixture()
  const now = Date.now
  try {
    target.hold()
    for (let batch = 0; batch < 120; batch++) {
      const res = response()
      await target.runtime.events(
        {
          headers: { origin: 'https://host.example', host: 'host.example' },
          body: {
            consent: true,
            events: Array.from({ length: 10 }, (_, item) => ({
              id: `event_${batch}_${item}`,
              kind: 'pageview',
              occurredAt: Date.now(),
              path: '/pricing'
            }))
          }
        },
        res
      )
      assert.equal(res.statusCode, 202)
    }
    const stats = target.runtime.getStats()
    assert.equal(stats.queued, 1000)
    assert.ok(stats.dropped >= 100)
    Date.now = () => now() + 121000
    assert.equal(target.runtime.getStatus(), 'unavailable')
    await target.runtime.flush()
    assert.equal(target.runtime.getStats().queued, 0)
  } finally {
    Date.now = now
    await target.close()
  }
})
