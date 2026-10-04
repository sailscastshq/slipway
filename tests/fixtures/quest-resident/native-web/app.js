const assert = require('node:assert/strict')
const fs = require('node:fs')
const dc = require('node:diagnostics_channel')
assert.equal(process.env.CI, 'true')
assert.equal(process.env.SLIPWAY_QUEST_RESTART_CI, '1')
const probe = require('./lib/probe')
const context = JSON.parse(
  fs.readFileSync(process.env.QUEST_NATIVE_CONTEXT, 'utf8')
)
assert.equal(fs.statSync(process.env.QUEST_NATIVE_CONTEXT).mode & 0o777, 0o600)
const destination = new URL(context.telemetryUrl)
assert.equal(destination.origin, `http://127.0.0.1:${destination.port}`)

// Passive standard Node diagnostics: no patched request, fetch, socket, hook,
// timer, buffer, flush or transport implementation.
dc.channel('http.client.request.start').subscribe(({ request }) => {
  assert.equal(request.host, '127.0.0.1')
  assert.equal(request.path, '/api/v1/telemetry/ingest')
  assert.equal(String(request.getHeader('host')), destination.host)
  request.once('response', (response) => {
    probe('telemetry:response', { status: response.statusCode })
    response.resume()
  })
  request.once('error', (error) =>
    probe('telemetry:error', { code: error.code })
  )
})
const sails = require('sails')
let closing = false
async function close() {
  if (closing) return
  closing = true
  await new Promise((resolve, reject) =>
    sails.lower((error) => (error ? reject(error) : resolve()))
  )
  process.exit(0)
}
process.on('SIGTERM', () => close().catch(() => process.exit(1)))
process.on('disconnect', () => close().catch(() => process.exit(1)))
sails.lift(sails.getRc(), async (error) => {
  try {
    if (error) throw error
    assert.equal(sails.config.quest.autoStart, false)
    assert.ok(sails.hooks.http)
    const address = sails.hooks.http.server.address()
    assert.equal(address.address, '127.0.0.1')
    const runtime = sails.quest.getRuntime()
    for (const capability of [
      'residentState',
      'runIdentity',
      'inputMetadata',
      'businessResults',
      'childSchedulerSuppression',
      'triggerProvenance',
      'terminalExitCode',
      'terminalSignal'
    ])
      assert.equal(runtime.capabilities[capability], true)
    assert.ok(
      sails.quest.metadata().every((job) => job.inputMetadataAvailable === true)
    )
    process.send({
      type: 'ready',
      pid: process.pid,
      port: address.port,
      runtimeId: runtime.runtimeId
    })
  } catch (failure) {
    console.error(failure.stack)
    process.exit(1)
  }
})
