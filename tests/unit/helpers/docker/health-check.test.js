const http = require('http')

const { test } = require('sounding')

test('docker health check passes when the configured path returns a 2xx response', async ({
  sails,
  expect
}) => {
  const deployLogs = []
  const originalAppendDeployLog = Deployment.appendDeployLog
  const server = http.createServer((req, res) => {
    if (req.url === '/ready') {
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(404)
    res.end()
  })

  Deployment.appendDeployLog = async (deploymentId, line) => {
    deployLogs.push({ deploymentId, line: String(line) })
  }

  try {
    const port = await listen(server)

    const result = await sails.helpers.docker.healthCheck.with({
      containerName: '127.0.0.1',
      port,
      path: 'ready',
      timeout: 300,
      interval: 10,
      deploymentId: 'deployment-1'
    })

    expect(result.statusCode).toBe(204)
    expect(result.attempts).toBe(1)
    expect(deployLogs).toEqual([
      {
        deploymentId: 'deployment-1',
        line: `Health check: polling http://127.0.0.1:${port}/ready (timeout: 0s)\n`
      },
      {
        deploymentId: 'deployment-1',
        line: `Health check passed: http://127.0.0.1:${port}/ready returned HTTP 204 (attempt 1)\n`
      }
    ])
  } finally {
    Deployment.appendDeployLog = originalAppendDeployLog
    await close(server)
  }
})

test('docker health check rejects non-2xx responses from the configured path', async ({
  sails,
  expect
}) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/login') {
      res.writeHead(302, { Location: '/dashboard' })
      res.end()
      return
    }

    res.writeHead(404)
    res.end()
  })

  try {
    const port = await listen(server)
    let error

    try {
      await sails.helpers.docker.healthCheck.with({
        containerName: '127.0.0.1',
        port,
        path: '/login',
        timeout: 80,
        interval: 10
      })
    } catch (err) {
      error = err
    }

    expect(error).toBeDefined()
    expect(error.message).toMatch(
      /127\.0\.0\.1:[0-9]+\/login returned HTTP 302/
    )
  } finally {
    await close(server)
  }
})

test('docker health check stops polling when its deployment is cancelled', async ({
  sails,
  expect
}) => {
  const controller = new AbortController()
  const cancellation = new Error('Cancelled by Builder')
  cancellation.code = 'DEPLOYMENT_CANCELLED'
  const startedAt = Date.now()
  const check = sails.helpers.docker.healthCheck.with({
    containerName: '127.0.0.1',
    port: 1,
    path: '/health',
    timeout: 10_000,
    interval: 5_000,
    signal: controller.signal
  })

  setTimeout(() => controller.abort(cancellation), 20)

  let error
  try {
    await check
  } catch (err) {
    error = err
  }

  expect(error.code).toBe('DEPLOYMENT_CANCELLED')
  expect(Date.now() - startedAt < 1000).toBe(true)
})

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

function close(server) {
  if (!server.listening) return Promise.resolve()

  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

test('startup HTTP probe enforces a total deadline even while headers trickle in', async ({
  sails
}) => {
  const assert = require('node:assert/strict')
  const net = require('node:net')
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.write('HTTP/1.1 200 OK\r\nX-Synthetic: ')
    const timer = setInterval(() => socket.write('x'), 10)
    socket.on('close', () => {
      clearInterval(timer)
      sockets.delete(socket)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const started = Date.now()
  try {
    await assert.rejects(
      sails.helpers.docker.healthCheck.with({
        containerName: '127.0.0.1',
        port: server.address().port,
        path: '/health',
        timeout: 100,
        interval: 10
      }),
      (error) => error.code === 'DEPLOYMENT_STARTUP_TIMEOUT'
    )
    assert(Date.now() - started < 1000)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
})
