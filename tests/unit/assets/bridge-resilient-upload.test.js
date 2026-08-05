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
