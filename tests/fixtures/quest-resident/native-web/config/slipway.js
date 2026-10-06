const fs = require('node:fs')
const assert = require('node:assert/strict')
const context = JSON.parse(
  fs.readFileSync(process.env.QUEST_NATIVE_CONTEXT, 'utf8')
)
const url = new URL(context.telemetryUrl)
assert.equal(url.protocol, 'http:')
assert.equal(url.hostname, '127.0.0.1')
assert.ok(Number(url.port) > 0)
assert.equal(url.pathname, '/api/v1/telemetry/ingest')
module.exports.slipway = {
  quest: {
    enabled: true,
    delivery: {
      directory: require('node:path').join(
        context.root,
        `quest-delivery-${context.appId}-${context.deploymentId}`
      )
    }
  },
  lookout: {
    enabled: true,
    telemetryUrl: context.telemetryUrl,
    telemetryToken: context.telemetryToken,
    batchSize: 1000,
    flushInterval: 600000,
    heartbeatInterval: 600000,
    captureQuestEvents: true,
    captureExceptions: false,
    captureQueries: false,
    captureCache: false
  },
  flags: { enabled: false },
  wake: { enabled: false },
  bearing: { enabled: false },
  bridge: { enabled: false }
}
