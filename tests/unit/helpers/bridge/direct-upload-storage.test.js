const http = require('node:http')
const { test } = require('sounding')

const storage = {
  key: 'test-access-key',
  secret: 'test-secret-key',
  bucket: 'course-videos',
  endpoint: 'https://account.r2.cloudflarestorage.com',
  region: 'auto'
}

test('Bridge signs a short-lived direct PUT for the exact R2 object', async ({
  sails,
  expect
}) => {
  const result = await sails.helpers.bridge.directUploadStorage.with({
    operation: 'signPut',
    storage,
    objectPath: 'courses/durable-ui/welcome/lesson-opaque.mp4',
    contentType: 'video/mp4'
  })
  const signed = new URL(result.uploadUrl)

  expect(signed.origin).toBe('https://account.r2.cloudflarestorage.com')
  expect(signed.pathname).toBe(
    '/course-videos/courses/durable-ui/welcome/lesson-opaque.mp4'
  )
  expect(signed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
  expect(signed.searchParams.get('X-Amz-Expires')).toBe('3600')
  expect(signed.searchParams.get('X-Amz-SignedHeaders')).toContain(
    'content-type'
  )
})

test('Bridge verifies a single upload without multipart state', async ({
  sails,
  expect
}) => {
  const server = http.createServer((req, res) => {
    expect(req.method).toBe('HEAD')
    expect(req.url).toBe('/course-videos/sponsors/opaque-logo.webp')
    res.writeHead(200, {
      'Content-Length': '4096',
      'Content-Type': 'image/webp',
      ETag: '"verified-logo"'
    })
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const result = await sails.helpers.bridge.directUploadStorage.with({
      operation: 'head',
      storage: {
        ...storage,
        endpoint: `http://127.0.0.1:${port}`
      },
      objectPath: 'sponsors/opaque-logo.webp'
    })

    expect(result).toEqual({
      size: 4096,
      type: 'image/webp',
      etag: 'verified-logo'
    })
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('Bridge signs only explicit numbered multipart parts', async ({
  sails,
  expect
}) => {
  const result = await sails.helpers.bridge.directUploadStorage.with({
    operation: 'signParts',
    storage,
    objectPath: 'courses/durable-ui/welcome/lesson-opaque.mp4',
    uploadId: 'opaque-upload-id',
    partNumbers: [2, 4]
  })

  expect(result.parts.map(({ partNumber }) => partNumber)).toEqual([2, 4])
  for (const part of result.parts) {
    const signed = new URL(part.uploadUrl)
    expect(signed.searchParams.get('partNumber')).toBe(String(part.partNumber))
    expect(signed.searchParams.get('uploadId')).toBe('opaque-upload-id')
  }
})

test('Bridge multipart signatures authenticate the headerless browser request while single PUT still binds its MIME type', async ({
  sails,
  expect
}) => {
  const secret = storage.secret
  const objectPath =
    'talk-material-uploads/proposal/talk with spaces+unicode-🌊.mp4'
  const result = await sails.helpers.bridge.directUploadStorage.with({
    operation: 'signParts',
    storage,
    objectPath,
    uploadId: 'opaque+/upload== id',
    partNumbers: [1, 24]
  })
  for (const part of result.parts) {
    const url = new URL(part.uploadUrl)
    expect(url.searchParams.get('uploadId')).toBe('opaque+/upload== id')
    expect(url.searchParams.get('partNumber')).toBe(String(part.partNumber))
    expect(
      [...url.searchParams.keys()].some((name) => /checksum/i.test(name))
    ).toBe(false)
    // A browser File.slice() Blob has no MIME type. XMLHttpRequest does not
    // send Content-Type for it. Verify SigV4 independently of the SDK signer.
    expect(verifySyntheticSignature(url, {}, secret)).toBe(true)
  }
  const single = await sails.helpers.bridge.directUploadStorage.with({
    operation: 'signPut',
    storage,
    objectPath: 'sponsors/logo.png',
    contentType: 'image/png'
  })
  expect(
    verifySyntheticSignature(
      new URL(single.uploadUrl),
      { 'content-type': 'image/png' },
      secret
    )
  ).toBe(true)
  expect(verifySyntheticSignature(new URL(single.uploadUrl), {}, secret)).toBe(
    false
  )
  expect(
    verifySyntheticSignature(
      new URL(single.uploadUrl),
      { 'content-type': 'video/mp4' },
      secret
    )
  ).toBe(false)
})

function verifySyntheticSignature(url, headers, secret) {
  const crypto = require('node:crypto')
  const encode = (value) =>
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
    )
  const names = url.searchParams.get('X-Amz-SignedHeaders').split(';')
  const actual = { host: url.host, ...headers }
  if (names.some((name) => !Object.hasOwn(actual, name))) return false
  const canonicalHeaders = names
    .map((name) => `${name}:${actual[name].trim().replace(/\s+/g, ' ')}\n`)
    .join('')
  const query = [...url.searchParams]
    .filter(([key]) => key !== 'X-Amz-Signature')
    .map(([key, value]) => [encode(key), encode(value)])
    .sort((a, b) =>
      a[0] < b[0]
        ? -1
        : a[0] > b[0]
        ? 1
        : a[1] < b[1]
        ? -1
        : a[1] > b[1]
        ? 1
        : 0
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const hash = (value) =>
    crypto.createHash('sha256').update(value).digest('hex')
  const request = [
    'PUT',
    url.pathname,
    query,
    canonicalHeaders,
    names.join(';'),
    url.searchParams.get('X-Amz-Content-Sha256')
  ].join('\n')
  const [access, ...scope] = url.searchParams.get('X-Amz-Credential').split('/')
  const signing = [
    'AWS4-HMAC-SHA256',
    url.searchParams.get('X-Amz-Date'),
    scope.join('/'),
    hash(request)
  ].join('\n')
  const hmac = (key, value) =>
    crypto.createHmac('sha256', key).update(value).digest()
  let key = Buffer.from('AWS4' + secret)
  for (const value of scope) key = hmac(key, value)
  return (
    hmac(key, signing).toString('hex') ===
    url.searchParams.get('X-Amz-Signature')
  )
}
