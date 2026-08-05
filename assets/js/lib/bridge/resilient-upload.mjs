export const DEFAULT_UPLOAD_CONCURRENCY = 3
export const DEFAULT_RETRY_DELAYS = [500, 1000]

export function fileFingerprint(file) {
  return [file.name, file.size, file.type, file.lastModified || 0].join(':')
}

export function uploadPartBounds(partNumber, partSize, fileSize) {
  const start = (partNumber - 1) * partSize
  const end = Math.min(start + partSize, fileSize)
  return { start, end, size: end - start }
}

export async function uploadMultipartParts({
  file,
  partSize,
  signedParts,
  uploadedParts = [],
  uploadPart,
  onProgress = () => {},
  signal,
  concurrency = DEFAULT_UPLOAD_CONCURRENCY,
  retryDelays = DEFAULT_RETRY_DELAYS
}) {
  if (!Number.isSafeInteger(partSize) || partSize < 5 * 1024 * 1024) {
    throw new Error('Bridge returned an invalid multipart part size.')
  }
  const uploaded = new Map(
    uploadedParts.map((part) => [Number(part.partNumber), Number(part.size)])
  )
  const queue = signedParts.map((part) => {
    const partNumber = Number(part.partNumber)
    const bounds = uploadPartBounds(partNumber, partSize, file.size)
    if (!part.uploadUrl || bounds.size <= 0) {
      throw new Error('Bridge returned an invalid multipart upload part.')
    }
    return { ...part, partNumber, ...bounds }
  })
  let completedBytes = [...uploaded.values()].reduce(
    (total, size) => total + size,
    0
  )
  const activeBytes = new Map()
  let cursor = 0
  let firstError

  const report = () => {
    const inFlight = [...activeBytes.values()].reduce(
      (total, size) => total + size,
      0
    )
    onProgress(Math.min(file.size, completedBytes + inFlight), file.size)
  }
  report()

  async function worker() {
    while (!firstError && cursor < queue.length) {
      throwIfAborted(signal)
      const part = queue[cursor]
      cursor += 1
      try {
        await uploadPartWithRetry({
          part,
          file,
          uploadPart,
          signal,
          retryDelays,
          onProgress(loaded) {
            activeBytes.set(
              part.partNumber,
              Math.max(0, Math.min(part.size, loaded))
            )
            report()
          }
        })
        activeBytes.delete(part.partNumber)
        uploaded.set(part.partNumber, part.size)
        completedBytes += part.size
        report()
      } catch (error) {
        activeBytes.delete(part.partNumber)
        firstError = error
        report()
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, queue.length || 1)) },
      () => worker()
    )
  )
  if (firstError) throw firstError
  report()
  return { uploadedBytes: completedBytes }
}

async function uploadPartWithRetry({
  part,
  file,
  uploadPart,
  signal,
  retryDelays,
  onProgress
}) {
  let lastError
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    throwIfAborted(signal)
    onProgress(0)
    try {
      await uploadPart({
        blob: file.slice(part.start, part.end),
        partNumber: part.partNumber,
        uploadUrl: part.uploadUrl,
        signal,
        onProgress
      })
      return
    } catch (error) {
      if (signal?.aborted || error.code === 'UPLOAD_CANCELLED') throw error
      lastError = error
      if (attempt < retryDelays.length) {
        await wait(retryDelays[attempt], signal)
      }
    }
  }
  throw lastError
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    let onAbort
    const finish = (callback, value) => {
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const timeout = setTimeout(() => finish(resolve), milliseconds)
    if (!signal) return
    onAbort = () => {
      clearTimeout(timeout)
      finish(reject, cancelledError())
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError()
}

function cancelledError() {
  const error = new Error('Upload cancelled.')
  error.code = 'UPLOAD_CANCELLED'
  return error
}
