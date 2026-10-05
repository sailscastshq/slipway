module.exports.port = 0
module.exports.explicitHost = '127.0.0.1'
module.exports.host = '127.0.0.1'
module.exports.routes = {
  'GET /health': function health(_req, res) {
    return res.json({ ok: true, pid: process.pid })
  }
}
module.exports.datastores = {
  default: { adapter: 'sails-sqlite', url: ':memory:' }
}
