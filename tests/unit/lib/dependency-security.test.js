const { test } = require('sounding')
const assert = require('node:assert/strict')
const path = require('node:path')
const http = require('node:http')
const { fork, execFileSync } = require('node:child_process')
const { gzipSync } = require('node:zlib')
const nodemailer = require('nodemailer')
const parseAddress = require('nodemailer/lib/addressparser')

const resolveFrom = (name, parent) =>
  require.resolve(name, { paths: [path.dirname(require.resolve(parent))] })

test('Mail envelopes retain the intended recipient through quoted and nested address syntax', async () => {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true
  })
  const cases = [
    [
      'Victim (x(y) <evil@evil.invalid>) <v@victim.invalid>',
      'v@victim.invalid'
    ],
    ['G: (a; <evil@evil.invalid>) <v@victim.invalid>;', 'v@victim.invalid'],
    ['<"a@evil.invalid>"@good.invalid>', '"a@evil.invalid>"@good.invalid']
  ]
  for (const [to, expected] of cases) {
    const result = await transport.sendMail({
      from: 'sender@slipway.invalid',
      to,
      subject: 'Parser fixture',
      text: 'Local stream only.'
    })
    const addresses = (items) =>
      items.flatMap((item) =>
        item.group ? addresses(item.group) : [item.address]
      )
    assert.deepEqual(addresses(parseAddress(to)), [expected])
    assert.equal(result.envelope.to.length, 1)
    // SMTP normalization can replace a literal > in the quoted local part.
    // It must retain the intended recipient domain rather than the injected one.
    assert.equal(
      result.envelope.to[0].slice(result.envelope.to[0].lastIndexOf('@')),
      expected.slice(expected.lastIndexOf('@'))
    )
  }
})

test('Comma query serialization handles an own non-callable toString without throwing', () => {
  const qs = require(resolveFrom('qs', 'body-parser'))
  assert.equal(
    qs.stringify({ a: [{ toString: 'x' }] }, { arrayFormat: 'comma' }),
    'a=%5Bobject%20Object%5D'
  )
})

test('IP parsing rejects pathological zone identifiers within a bounded child process', () => {
  const modulePath = resolveFrom('ip-address', 'express-rate-limit')
  const code = `const {Address6}=require(${JSON.stringify(
    modulePath
  )}); process.stdout.write(String(Address6.isValid('fe80::1' + '%'.repeat(100000) + '\\n')))`
  assert.equal(
    execFileSync(process.execPath, ['-e', code], {
      timeout: 2000,
      encoding: 'utf8'
    }),
    'false'
  )
})

for (const [name, modulePath, mode] of [
  ['Skipper production middleware', require.resolve('skipper'), 'skipper'],
  ['Sails body-parser 1.x', resolveFrom('body-parser', 'sails'), 'json'],
  ['Express body-parser 2.x', require.resolve('body-parser'), 'json']
]) {
  test(`${name} survives malformed trailing compressed data and serves the next request`, async () => {
    const child = fork(
      path.resolve('tests/fixtures/dependency-security/body-parser-server.cjs'),
      [modulePath, mode],
      { silent: true, execArgv: [] }
    )
    let errors = ''
    child.stderr.on('data', (data) => {
      errors = (errors + data).slice(-4000)
    })
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Parser fixture did not start')),
          5000
        )
        child.once('message', ({ port }) => {
          clearTimeout(timer)
          resolve(port)
        })
        child.once('exit', (code, signal) => {
          clearTimeout(timer)
          reject(new Error(`Parser exited (${code || signal}): ${errors}`))
        })
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })
      const valid = gzipSync(JSON.stringify({ ready: true }))
      const response = await request(port, valid)
      assert.equal(response.status, 200)
      assert.deepEqual(JSON.parse(response.body), { ready: true })
      // A valid compressed body followed by invalid decoder input used to emit
      // an unhandled error after the parser had already completed the response.
      await request(
        port,
        Buffer.concat([valid, Buffer.from('invalid-trailing-frame')])
      ).catch(() => {})
      const rejected = await request(
        port,
        Buffer.from('not-a-gzip-stream'),
        'application/json; charset=utf-8-unsupported'
      )
      assert.equal(rejected.status, 415)
      await new Promise((resolve) => setTimeout(resolve, 150))
      assert.equal(child.exitCode, null, errors)
      assert.equal(child.signalCode, null, errors)
      assert.deepEqual(await request(port), { status: 200, body: 'ok' })
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGTERM')
        await exited
      }
    }
  })
}

function request(port, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: body ? '/' : '/health',
        method: body ? 'POST' : 'GET',
        headers: body
          ? {
              'Content-Type': contentType,
              'Content-Encoding': 'gzip',
              'Content-Length': body.length
            }
          : {}
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          text += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode, body: text }))
      }
    )
    req.on('error', reject)
    req.setTimeout(2000, () =>
      req.destroy(new Error('Parser fixture request timed out'))
    )
    req.end(body)
  })
}
