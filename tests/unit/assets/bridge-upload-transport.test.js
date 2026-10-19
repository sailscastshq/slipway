const { test } = require('sounding')
const load = () => import('../../../assets/js/lib/bridge/upload-transport.mjs')
function fixture() {
  let now = 0,
    tick,
    cleared = false,
    request
  const clock = {
    now: () => now,
    setInterval(fn) {
      tick = fn
      return 1
    },
    clearInterval() {
      cleared = true
    }
  }
  class Request extends EventTarget {
    constructor() {
      super()
      request = this
      this.upload = new EventTarget()
      this.status = 0
    }
    open(method, url) {
      this.method = method
      this.url = url
    }
    setRequestHeader() {}
    send(blob) {
      this.blob = blob
    }
    abort() {
      this.aborted = true
      this.dispatchEvent(new Event('abort'))
    }
  }
  return {
    clock,
    Request,
    get request() {
      return request
    },
    advance(ms) {
      now += ms
      tick()
    },
    get cleared() {
      return cleared
    },
    progress(bytes) {
      const e = new Event('progress')
      Object.defineProperty(e, 'loaded', { value: bytes })
      request.upload.dispatchEvent(e)
    }
  }
}
test('Browser CORS/network failure never acknowledges sent bytes and produces no URL or credential disclosure', async ({
  expect
}) => {
  const { uploadBlob, uploadFailureMessage } = await load()
  const f = fixture()
  let error
  const pending = uploadBlob({
    blob: { size: 16 * 1024 ** 2 },
    uploadUrl: 'https://fixture.invalid/part?X-Amz-Signature=private',
    Request: f.Request,
    clock: f.clock
  }).catch((e) => {
    error = e
  })
  f.progress(16 * 1024 ** 2)
  f.request.dispatchEvent(new Event('error'))
  await pending
  expect(error.code).toBe('UPLOAD_NETWORK')
  expect(f.cleared).toBe(true)
  error.message = 'https://secret.invalid?X-Amz-Signature=private TOKEN=hidden'
  const text = uploadFailureMessage(error, 'uploading', {
    multipart: true,
    origin: 'https://sailsconf.com/private?token=hidden',
    confirmed: '16 MB',
    total: '371 MB'
  })
  expect(text).toContain('sending parts')
  expect(text).toContain('16 MB of 371 MB confirmed')
  expect(text).toContain('CORS for https://sailsconf.com')
  for (const secret of ['private', 'hidden', 'Signature', 'secret.invalid'])
    expect(text.includes(secret)).toBe(false)
})
test('XHR keeps the existing 45 second inactivity timeout and cleans up after a stall', async ({
  expect
}) => {
  const { uploadBlob } = await load()
  const f = fixture()
  let error
  const pending = uploadBlob({
    blob: { size: 16 },
    uploadUrl: 'https://fixture.invalid',
    Request: f.Request,
    clock: f.clock
  }).catch((e) => {
    error = e
  })
  f.advance(44000)
  expect(f.request.aborted).toBe(undefined)
  f.progress(8)
  f.advance(44000)
  expect(f.request.aborted).toBe(undefined)
  f.advance(1000)
  await pending
  expect(error.code).toBe('UPLOAD_STALLED')
  expect(f.cleared).toBe(true)
})
test('XHR cancellation remains distinct from a network/storage failure', async ({
  expect
}) => {
  const { uploadBlob } = await load()
  const f = fixture(),
    controller = new AbortController()
  let error
  const pending = uploadBlob({
    blob: { size: 16 },
    uploadUrl: 'https://fixture.invalid',
    signal: controller.signal,
    Request: f.Request,
    clock: f.clock
  }).catch((e) => {
    error = e
  })
  controller.abort()
  await pending
  expect(error.code).toBe('UPLOAD_CANCELLED')
  expect(f.cleared).toBe(true)
})
test('Upload failures identify recovery and verification without exposing arbitrary server error text', async ({
  expect
}) => {
  const { uploadFailureMessage, uploadHttpError } = await load()
  for (const phase of ['preparing', 'resuming', 'verifying']) {
    const text = uploadFailureMessage(
      { message: 'SECRET=hidden signed-url' },
      phase,
      { multipart: true }
    )
    expect(text.includes('hidden')).toBe(false)
    expect(text.includes('signed-url')).toBe(false)
  }
  expect(uploadFailureMessage(uploadHttpError(403), 'uploading')).toContain(
    'HTTP 403'
  )
  expect(
    uploadFailureMessage(
      uploadHttpError(400, 'BRIDGE_DIRECT_UPLOAD_INTENT_INVALID'),
      'resuming',
      { multipart: true }
    )
  ).toContain('explicitly start a new upload')
  expect(
    uploadFailureMessage(Error('No Access-Control-Allow-Origin'), 'verifying', {
      multipart: true
    })
  ).toContain('verifying the stored file')
})
