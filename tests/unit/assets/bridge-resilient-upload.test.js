const { test } = require('sounding')

const MIB = 1024 * 1024

test('Bridge multipart uploads retry failed parts and report aggregate bytes', async ({
  expect
}) => {
  const { uploadMultipartParts } = await import(
    '../../../assets/js/lib/bridge/resilient-upload.mjs'
  )
  const file = fakeFile(40 * MIB)
  const attempts = new Map()
  const progress = []
  let active = 0
  let maximumActive = 0

  await uploadMultipartParts({
    file,
    partSize: 16 * MIB,
    uploadedParts: [{ partNumber: 1, size: 16 * MIB }],
    signedParts: [
      { partNumber: 2, uploadUrl: 'https://r2.test/2' },
      { partNumber: 3, uploadUrl: 'https://r2.test/3' }
    ],
    retryDelays: [0],
    onProgress(loaded) {
      progress.push(loaded)
    },
    async uploadPart({ blob, partNumber, onProgress }) {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      const count = (attempts.get(partNumber) || 0) + 1
      attempts.set(partNumber, count)
      onProgress(Math.floor(blob.size / 2))
      await Promise.resolve()
      active -= 1
      if (partNumber === 2 && count === 1) {
        throw new Error('temporary network failure')
      }
      onProgress(blob.size)
    }
  })

  expect(attempts.get(2)).toBe(2)
  expect(attempts.get(3)).toBe(1)
  expect(maximumActive <= 3).toBe(true)
  expect(progress.at(-1)).toBe(file.size)
})

test('Bridge multipart upload cancellation stops before another part starts', async ({
  expect
}) => {
  const { uploadMultipartParts } = await import(
    '../../../assets/js/lib/bridge/resilient-upload.mjs'
  )
  const controller = new AbortController()
  controller.abort()

  let receivedError
  try {
    await uploadMultipartParts({
      file: fakeFile(32 * MIB),
      partSize: 16 * MIB,
      signedParts: [
        { partNumber: 1, uploadUrl: 'https://r2.test/1' },
        { partNumber: 2, uploadUrl: 'https://r2.test/2' }
      ],
      signal: controller.signal,
      uploadPart: async () => {
        throw new Error('must not start')
      }
    })
  } catch (error) {
    receivedError = error
  }
  expect(receivedError.code).toBe('UPLOAD_CANCELLED')
})

function fakeFile(size) {
  return {
    name: 'lesson.mp4',
    size,
    type: 'video/mp4',
    lastModified: 123,
    slice(start, end) {
      return { size: end - start }
    }
  }
}

test('371 MiB interrupted multipart retains acknowledged progress and resumes only missing parts', async ({
  expect
}) => {
  const { uploadMultipartParts } = await import(
    '../../../assets/js/lib/bridge/resilient-upload.mjs'
  )
  const file = fakeFile(371 * MIB),
    partSize = 16 * MIB,
    count = Math.ceil(file.size / partSize)
  const stored = new Map(),
    calls = [],
    progress = [],
    retries = []
  let fail = true,
    active = 0,
    maximum = 0
  const signed = () =>
    Array.from({ length: count }, (_, i) => i + 1)
      .filter((n) => !stored.has(n))
      .map((partNumber) => ({
        partNumber,
        uploadUrl: `https://fixture.invalid/part/${partNumber}`
      }))
  const uploadPart = async ({ blob, partNumber, onProgress }) => {
    calls.push({ partNumber, size: blob.size })
    active++
    maximum = Math.max(maximum, active)
    onProgress(blob.size)
    await Promise.resolve()
    active--
    if (fail && partNumber === 2) {
      const error = Error('CORS/network response unavailable')
      error.code = 'UPLOAD_NETWORK'
      throw error
    }
    stored.set(partNumber, blob.size)
  }
  const observe = (confirmed, total, details) => {
    progress.push(confirmed)
    retries.push(...details.retryingParts)
    expect(total).toBe(file.size)
    expect(confirmed <= [...stored.values()].reduce((a, b) => a + b, 0)).toBe(
      true
    )
  }
  let error
  try {
    await uploadMultipartParts({
      file,
      partSize,
      signedParts: signed(),
      uploadPart,
      onProgress: observe,
      retryDelays: [0, 0]
    })
  } catch (e) {
    error = e
  }
  expect(error.code).toBe('UPLOAD_NETWORK')
  expect(calls.filter((c) => c.partNumber === 2).length).toBe(3)
  expect(retries.includes(2)).toBe(true)
  const confirmed = [...stored.values()].reduce((a, b) => a + b, 0)
  expect(progress.at(-1)).toBe(confirmed)
  expect(confirmed < file.size).toBe(true)
  const before = calls.length
  fail = false
  await uploadMultipartParts({
    file,
    partSize,
    signedParts: signed(),
    uploadedParts: [...stored].map(([partNumber, size]) => ({
      partNumber,
      size
    })),
    uploadPart,
    onProgress: observe,
    retryDelays: [0, 0]
  })
  expect(calls.slice(before).map((c) => c.partNumber)).toEqual([2])
  expect(progress.every((n, i) => i === 0 || n >= progress[i - 1])).toBe(true)
  expect(progress.at(-1)).toBe(file.size)
  expect(stored.size).toBe(24)
  expect(stored.get(24)).toBe(3 * MIB)
  expect(calls.every((c) => c.size <= 16 * MIB && c.size < file.size)).toBe(
    true
  )
  expect(maximum <= 3).toBe(true)
})

test('Multipart does not retry a known permanent storage rejection', async ({
  expect
}) => {
  const { uploadMultipartParts } = await import(
    '../../../assets/js/lib/bridge/resilient-upload.mjs'
  )
  const { uploadHttpError } = await import(
    '../../../assets/js/lib/bridge/upload-transport.mjs'
  )
  let calls = 0,
    error
  try {
    await uploadMultipartParts({
      file: fakeFile(371 * MIB),
      partSize: 16 * MIB,
      signedParts: [
        { partNumber: 1, uploadUrl: 'https://fixture.invalid/part/1' }
      ],
      uploadPart: async () => {
        calls++
        throw uploadHttpError(403)
      },
      retryDelays: [0, 0]
    })
  } catch (e) {
    error = e
  }
  expect(calls).toBe(1)
  expect(error.status).toBe(403)
})
