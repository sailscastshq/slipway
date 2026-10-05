const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { once } = require('node:events')
const createClient = require('../../api/lib/upgrade-docker-api')
async function fixture(handler, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-api-'))
  const socket = path.join(directory, 'api.sock')
  const server = http.createServer(handler)
  server.listen(socket)
  try {
    await once(server, 'listening')
    await run(createClient(socket))
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
const neutral = (error) =>
  error.code === 'upgradeDockerFailed' &&
  !error.message.includes('synthetic-secret')
test('structured Docker calls preserve JSON bodies and confirm empty successes', async () => {
  const received = []
  await fixture(
    async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      received.push({
        method: request.method,
        path: request.url,
        body: Buffer.concat(chunks).toString()
      })
      if (request.method === 'POST')
        response.end(JSON.stringify({ Id: 'fixture' }))
      else {
        response.statusCode = 204
        response.end()
      }
    },
    async (client) => {
      const body = {
        Env: ['SESSION_SECRET=synthetic-secret\n$(ignored)'],
        Labels: { upgrade: 'fixture' }
      }
      assert.deepEqual(await client('POST', '/containers/create', body, 1000), {
        Id: 'fixture'
      })
      assert.equal(
        await client('DELETE', '/containers/fixture', undefined, 1000),
        null
      )
      assert.deepEqual(JSON.parse(received[0].body), body)
      assert.equal(received[0].path, '/v1.47/containers/create')
      assert.equal(received[1].method, 'DELETE')
    }
  )
})
test('Docker failures and malformed or oversized output stay bounded and neutral', async () => {
  for (const mode of ['failed', 'invalid', 'oversized', 'hung']) {
    await fixture(
      (_request, response) => {
        if (mode === 'hung') return
        if (mode === 'failed') response.statusCode = 500
        response.end(
          mode === 'oversized'
            ? 'synthetic-secret'.repeat(160000)
            : 'synthetic-secret'
        )
      },
      async (client) => {
        const started = Date.now()
        await assert.rejects(client('GET', '/fixture', undefined, 100), neutral)
        assert.ok(Date.now() - started < 2000)
      }
    )
  }
})
test('invalid Docker requests fail before connecting to the socket', async () => {
  const client = createClient('/missing-slipway-docker.sock')
  const cyclic = {}
  cyclic.self = cyclic
  for (const args of [
    ['PUT', '/x'],
    ['GET', 'x'],
    ['GET', null],
    ['GET', '/x', undefined, 0],
    ['POST', '/x', cyclic],
    ['POST', '/x', { secret: 'synthetic-secret'.repeat(100000) }]
  ])
    await assert.rejects(client(...args), neutral)
})
