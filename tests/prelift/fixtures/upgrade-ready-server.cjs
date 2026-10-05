const http = require('node:http')
const startup = require('../../../api/lib/upgrade-startup')
const options = {
  markerFile: process.env.SLIPWAY_UPGRADE_MARKER,
  version: '0.0.88',
  image: process.env.SLIPWAY_UPGRADE_IMAGE,
  instanceId: process.env.SLIPWAY_UPGRADE_INSTANCE,
  manifestHash: process.env.SLIPWAY_UPGRADE_MANIFEST
}
// Synthetic Linux fixture, not the application entrypoint. Exercise the real
// admission guard and native receipts before any readiness is exposed.
startup.verify(options)
http
  .createServer((req, res) => {
    try {
      const upgrade = startup.verify(options)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ status: 'ok', upgrade }))
    } catch {
      res.statusCode = 503
      res.end('{}')
    }
  })
  .listen(1337, '0.0.0.0')
