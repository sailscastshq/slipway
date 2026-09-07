const { test } = require('sounding')
const http = require('node:http')
const { Readable } = require('node:stream')
const { once } = require('node:events')
const createAdapter = require('../../../api/lib/s3-upload-adapter')

test('AWS v3 adapter streams single and multipart objects, reads and deletes, and enforces limits', async ({
  expect
}) => {
  const objects = new Map(),
    parts = new Map()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    res.setHeader('content-type', 'application/xml')
    if (req.method === 'POST' && url.searchParams.has('uploads'))
      return res.end(
        '<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>'
      )
    if (req.method === 'PUT') {
      if (url.searchParams.has('partNumber'))
        parts.set(Number(url.searchParams.get('partNumber')), body)
      else objects.set(url.pathname, body)
      res.setHeader('etag', '"test-etag"')
      return res.end()
    }
    if (req.method === 'POST' && url.searchParams.has('uploadId')) {
      objects.set(
        url.pathname,
        Buffer.concat(
          [...parts].sort((a, b) => a[0] - b[0]).map((item) => item[1])
        )
      )
      return res.end(
        '<CompleteMultipartUploadResult><ETag>test-etag</ETag></CompleteMultipartUploadResult>'
      )
    }
    if (req.method === 'DELETE') {
      objects.delete(url.pathname)
      res.statusCode = 204
      return res.end()
    }
    if (req.method === 'GET') {
      res.setHeader('content-type', 'application/octet-stream')
      return res.end(objects.get(url.pathname))
    }
    res.statusCode = 400
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const adapter = createAdapter({
    key: 'test-key',
    secret: 'test-secret',
    bucket: 'test-bucket',
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${server.address().port}`
  })
  async function upload(name, data, maxBytes) {
    const input = Readable.from([data])
    input.skipperFd = name
    input.headers = { 'content-type': 'application/octet-stream' }
    const receiver = adapter.receive({ maxBytes })
    const finished = once(receiver, 'finish')
    receiver.end(input)
    await finished
    return input.byteCount
  }
  try {
    for (const [name, bytes] of [
      ['small.bin', 1024],
      ['large.bin', 7 * 1024 * 1024]
    ]) {
      const data = Buffer.alloc(bytes, 42)
      expect(await upload(name, data, 8 * 1024 * 1024)).toBe(bytes)
      const received = []
      for await (const chunk of adapter.read(name)) received.push(chunk)
      expect(Buffer.concat(received).equals(data)).toBe(true)
      await new Promise((resolve, reject) =>
        adapter.rm(name, (error) => (error ? reject(error) : resolve()))
      )
      expect(objects.has(`/test-bucket/${name}`)).toBe(false)
    }
    let code
    try {
      await upload('too-large.bin', Buffer.alloc(4096), 1000)
    } catch (error) {
      code = error.code
    }
    expect(code).toBe('E_EXCEEDS_UPLOAD_LIMIT')
    expect(objects.has('/test-bucket/too-large.bin')).toBe(false)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('maintained base64 encoder and Nodemailer preserve upload and mail contracts', async ({
  expect
}) => {
  const path = require('node:path')
  const B64 = require(require.resolve('b64', {
    paths: [path.dirname(require.resolve('sails-hook-uploads'))]
  }))
  const encoder = new B64.Encoder(),
    chunks = []
  const consuming = (async () => {
    for await (const chunk of encoder) chunks.push(chunk)
  })()
  encoder.write(Buffer.from('ab'))
  encoder.write(Buffer.from('cdef'))
  encoder.end(Buffer.from('g'))
  await consuming
  expect(Buffer.concat(chunks).toString()).toBe(
    Buffer.from('abcdefg').toString('base64')
  )
  const transport = require('nodemailer').createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix'
  })
  const result = await transport.sendMail({
    from: 'Slipway <sender@example.test>',
    to: 'recipient@example.test',
    subject: 'Restore completed',
    text: 'Verify the database before resuming writes.',
    disableFileAccess: true,
    disableUrlAccess: true
  })
  expect(result.message.toString()).toContain('Subject: Restore completed')
  expect(result.message.toString()).toContain(
    'Verify the database before resuming writes.'
  )
})
