const { test } = require('sounding')
const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const { EventEmitter } = require('node:events')
const { spawnSync } = require('node:child_process')
const {
  probe,
  parseTarget,
  isPublicAddress
} = require('../../../api/lib/beacon/probe')
const {
  initialState,
  observe,
  statusAt,
  STALE_AFTER_MS
} = require('../../../api/lib/beacon/availability')

const publicAnswers = async () => [{ address: '93.184.216.34', family: 4 }]

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

test('Beacon blocks private, metadata, reserved and transition addresses', () => {
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.100.100.200',
    '127.0.0.1',
    '169.254.169.254',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.8',
    '192.0.2.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '168.63.129.16',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '64:ff9b::a00:1',
    '2002:a00:1::',
    '2001::1',
    '2001:db8::1',
    '3fff::1',
    'not-an-ip'
  ])
    assert.equal(isPublicAddress(address), false, address)
  for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(address), true, address)
  }
})

test('Beacon normalizes URLs and rejects credentials, schemes, ports and encoded local IPs', () => {
  for (const target of [
    'file:///etc/passwd',
    'ftp://example.com',
    'https://user:secret@example.com',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://[::ffff:127.0.0.1]',
    'https://example.com:8443',
    'invalid'
  ])
    assert.throws(() => parseTarget(target), undefined, target)
  assert.equal(
    parseTarget('https://example.com:443/ready#fragment').url.href,
    'https://example.com/ready'
  )
})

test('Beacon rejects mixed and malformed DNS answers before opening a socket', async () => {
  for (const answers of [
    [],
    [...(await publicAnswers()), { address: '10.0.0.1', family: 4 }],
    [{ address: '93.184.216.34', family: 6 }],
    [{ address: '169.254.169.254', family: 4 }]
  ]) {
    const result = await probe(
      'https://example.com',
      {},
      {
        lookup: async () => answers,
        request: () => assert.fail('blocked target must not open a socket')
      }
    )
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.reason, 'blocked_target')
  }
})

test('Beacon pins the DNS answer while preserving the TLS hostname and never follows redirects', async () => {
  let requests = 0
  const result = await probe(
    'https://example.com/ready',
    {},
    {
      lookup: publicAnswers,
      request(url, options, respond) {
        requests++
        assert.equal(url.hostname, 'example.com')
        assert.equal(options.agent, false)
        assert.equal(options.rejectUnauthorized, true)
        options.lookup('example.com', {}, (_, address, family) => {
          assert.equal(address, '93.184.216.34')
          assert.equal(family, 4)
        })
        options.lookup('example.com', { all: true }, (_, answers) => {
          assert.deepEqual(answers, [{ address: '93.184.216.34', family: 4 }])
        })
        const req = new EventEmitter()
        req.destroy = () => {}
        req.end = () => {
          const response = new EventEmitter()
          response.statusCode = 302
          response.headers = { location: 'http://169.254.169.254/' }
          response.destroy = () => {}
          respond(response)
        }
        return req
      }
    }
  )
  assert.equal(requests, 1)
  assert.equal(result.outcome, 'down')
  assert.equal(result.statusCode, 302)
})

test('Beacon times out unresolved DNS and does not connect after its deadline', async () => {
  let complete
  const result = await probe(
    'https://example.com',
    { timeoutMs: 20 },
    {
      lookup: () =>
        new Promise((resolve) => {
          complete = resolve
        }),
      request: () => assert.fail('expired DNS must not open a socket')
    }
  )
  assert.equal(result.reason, 'timeout')
  complete(await publicAnswers())
  await new Promise(setImmediate)
  await assert.rejects(probe('https://example.com', { timeoutMs: 30001 }))
})

test('Beacon checks real response headers without consuming an endless body', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(204)
    res.flushHeaders()
  })
  await listen(server)
  try {
    // Only this test transport routes an approved public target to a local fixture.
    const result = await probe(
      'http://example.com/ready',
      { timeoutMs: 1000 },
      {
        lookup: publicAnswers,
        request: (_url, options, respond) =>
          http.request(
            {
              ...options,
              hostname: '127.0.0.1',
              port: server.address().port,
              lookup: undefined,
              path: '/ready'
            },
            respond
          )
      }
    )
    assert.equal(result.outcome, 'up')
    assert.equal(result.statusCode, 204)
    assert.equal(Number.isInteger(result.durationMs), true)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Beacon enforces a total deadline against trickling HTTP headers', async () => {
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.write('HTTP/1.1 200 OK\r\nX-Slow: ')
    const timer = setInterval(() => socket.write('x'), 5)
    socket.on('close', () => {
      clearInterval(timer)
      sockets.delete(socket)
    })
  })
  await listen(server)
  try {
    const result = await probe(
      'http://example.com',
      { timeoutMs: 60 },
      {
        lookup: publicAnswers,
        request: (_url, options, respond) =>
          http.request(
            {
              ...options,
              hostname: '127.0.0.1',
              port: server.address().port,
              lookup: undefined
            },
            respond
          )
      }
    )
    assert.equal(result.outcome, 'down')
    assert.equal(result.reason, 'timeout')
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Beacon confirms failures and recovery once and retains last successful observation', () => {
  let state = initialState()
  const feed = (outcome, checkedAt) => {
    const result = observe(state, { outcome, checkedAt })
    state = result.state
    return result.event
  }
  assert.equal(statusAt(state, 0), 'unknown')
  assert.equal(feed('up', 0), null)
  assert.equal(state.status, 'unknown')
  feed('up', 60000)
  assert.equal(state.status, 'up')
  feed('down', 120000)
  assert.equal(state.status, 'up')
  assert.deepEqual(feed('down', 180000), {
    type: 'incident_opened',
    at: 180000
  })
  assert.equal(feed('down', 240000), null)
  assert.equal(state.lastSuccessAt, 60000)
  feed('up', 300000)
  assert.equal(state.status, 'down')
  assert.deepEqual(feed('up', 360000), {
    type: 'incident_resolved',
    at: 360000,
    openedAt: 180000
  })
  assert.equal(feed('up', 420000), null)
  assert.equal(state.status, 'up')
  assert.equal(state.lastSuccessAt, 420000)
})

test('Beacon treats gaps as Unknown, restarts confirmation and preserves unresolved incidents', () => {
  let { state } = observe(initialState(), { outcome: 'down', checkedAt: 0 })
  ;({ state } = observe(state, { outcome: 'down', checkedAt: 60000 }))
  assert.equal(statusAt(state, 60000 + STALE_AFTER_MS), 'unknown')
  let result = observe(state, {
    outcome: 'down',
    checkedAt: 60000 + STALE_AFTER_MS
  })
  assert.equal(result.state.status, 'unknown')
  assert.equal(result.event, null)
  assert.equal(result.state.incidentOpenedAt, 60000)
  result = observe(result.state, { outcome: 'up', checkedAt: 300000 })
  assert.equal(result.state.status, 'unknown')
  result = observe(result.state, { outcome: 'up', checkedAt: 360000 })
  assert.equal(result.event.type, 'incident_resolved')
  const duplicate = observe(result.state, {
    outcome: 'down',
    checkedAt: 360000
  })
  assert.equal(duplicate.state, result.state)
  assert.equal(duplicate.event, null)
  assert.throws(() => observe(result.state, { outcome: 'up', checkedAt: NaN }))
  result = observe(result.state, { outcome: 'unknown', checkedAt: 420000 })
  assert.equal(result.state.status, 'unknown')
  assert.equal(result.state.consecutiveUp, 0)
})

test('Beacon CLI rejects unsafe targets without leaking URL credentials', () => {
  const result = spawnSync(
    process.execPath,
    ['tools/beacon-check.cjs', 'https://private:do-not-print@example.com'],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.includes('do-not-print'), false)
})
