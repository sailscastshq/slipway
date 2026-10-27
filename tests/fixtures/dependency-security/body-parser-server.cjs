// Disposable child process: a parser crash must never terminate the test runner.
const path = require('node:path')
const express = require(require.resolve('express', {
  paths: [path.dirname(require.resolve('sails'))]
}))
const dependency = require(process.argv[2])
// Production config supplies a raw-body verification callback for webhooks.
const options = { verify() {} }
const parser =
  process.argv[3] === 'skipper' ? dependency(options) : dependency.json(options)
const app = express()
app.get('/health', (_req, res) => res.send('ok'))
app.use(parser)
app.post('/', (req, res) => res.json(req.body))
app.use((error, _req, res, _next) =>
  res.status(error.status || 400).json({ error: error.message })
)
const server = app.listen(0, '127.0.0.1', () =>
  process.send({ port: server.address().port })
)
