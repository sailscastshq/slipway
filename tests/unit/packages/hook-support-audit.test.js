const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const audit = require('../../../packages/hook/lib/bridge-support-audit')
const install = require('../../../packages/hook/lib/bridge-support-install')
test('support audit retries the same durable event after restart and refuses an unacknowledged start', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'support-audit-'))
  const host = { config: { appPath: directory }, log: { warn() {} } }
  let original
  const offline = audit(host, '42', async (body) => {
    original = body
    throw Error('offline')
  })
  try {
    await assert.rejects(offline.record({ id: '1' }, 'started', true))
    await offline.stop()
    const delivered = []
    const online = audit(host, '42', async (body) => delivered.push(body))
    await online.flush()
    await online.flush()
    assert.deepEqual(delivered, [original])
    await online.stop()
  } finally {
    await offline.stop()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
test('support installation fails closed on reserved route collisions or missing sessions', async () => {
  for (const routes of [
    { 'GET /_slipway/bridge/impersonation/start': {} },
    {}
  ]) {
    const config = { enabled: true }
    const host = {
      config: {
        routes,
        slipway: { bridge: { impersonation: config } },
        http: { middleware: { order: ['bodyParser', 'router'] } }
      },
      log: { warn() {} }
    }
    install(host, () => null)
    assert.equal(config.enabled, false)
    assert.deepEqual(host.config.http.middleware.order, [
      'bodyParser',
      'router'
    ])
  }
})
