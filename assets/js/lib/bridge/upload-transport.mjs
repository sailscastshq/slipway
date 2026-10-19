// Public error descriptions are selected from codes, never provider messages,
// signed URLs, request bodies, credentials, or arbitrary server text.
export function uploadHttpError(status, code) {
  const error = new Error('Upload request failed.')
  error.code = [
    'BRIDGE_DIRECT_UPLOAD_INTENT_INVALID',
    'BRIDGE_MULTIPART_UPLOAD_MISSING'
  ].includes(code)
    ? 'UPLOAD_SESSION_EXPIRED'
    : 'UPLOAD_REJECTED'
  if (Number.isInteger(status) && status >= 100 && status <= 599)
    error.status = status
  error.retryable = status === 408 || status === 429 || status >= 500
  return error
}
function failure(code) {
  const error = new Error('Upload transport failed.')
  error.code = code
  return error
}
export function uploadFailureMessage(
  error,
  phase,
  { multipart = false, origin, confirmed, total } = {}
) {
  if (error?.code === 'UPLOAD_CANCELLED')
    return 'Upload cancelled. You can retry when ready.'
  const stages = {
    preparing: 'preparing the upload',
    resuming: 'recovering stored parts',
    uploading: multipart ? 'sending parts' : 'sending the file',
    verifying: 'verifying the stored file'
  }
  let detail
  if (error?.code === 'UPLOAD_NETWORK') {
    let site = ''
    try {
      const url = new URL(origin)
      if (['https:', 'http:'].includes(url.protocol))
        site = ` for ${url.origin}`
    } catch {
      /* no untrusted text */
    }
    detail = `The browser could not confirm the transfer. Check storage CORS${site} and your connection.`
  } else if (error?.code === 'UPLOAD_STALLED')
    detail =
      'No upload progress was received for 45 seconds. Check your connection and storage availability.'
  else if (error?.code === 'UPLOAD_SESSION_EXPIRED')
    detail =
      'The stored upload session is unavailable or expired. Choose the file again to explicitly start a new upload.'
  else if (
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status <= 599
  )
    detail = `The request was rejected (HTTP ${error.status}). Check upload permissions, file limits, and storage configuration.`
  else
    detail =
      'The request could not be confirmed. Check your connection and storage configuration.'
  const saved =
    multipart && confirmed && total
      ? ` ${confirmed} of ${total} confirmed.`
      : ''
  const resume =
    multipart && error?.code !== 'UPLOAD_SESSION_EXPIRED'
      ? ' Retry rechecks stored parts before sending more.'
      : ''
  return `Upload ${multipart ? 'paused' : 'failed'} while ${
    stages[phase] || 'processing the upload'
  }.${saved} ${detail}${resume}`
}
export function uploadBlob({
  blob,
  uploadUrl,
  headers = {},
  signal,
  onProgress = () => {},
  Request = globalThis.XMLHttpRequest,
  clock = {
    now: () => Date.now(),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args)
  }
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(failure('UPLOAD_CANCELLED'))
    const request = new Request()
    let settled = false,
      stalled = false,
      lastProgressAt = clock.now()
    request.open('PUT', uploadUrl)
    for (const [name, value] of Object.entries(headers || {}))
      request.setRequestHeader(name, value)
    request.upload.addEventListener('progress', (event) => {
      if (settled) return
      lastProgressAt = clock.now()
      onProgress(Math.max(0, Math.min(blob.size, event.loaded)), blob.size)
    })
    request.addEventListener('load', () => {
      if (settled) return
      if (request.status >= 200 && request.status < 300) {
        onProgress(blob.size, blob.size)
        finish(resolve)
      } else
        finish(
          reject,
          request.status
            ? uploadHttpError(request.status)
            : failure('UPLOAD_NETWORK')
        )
    })
    request.addEventListener('error', () =>
      finish(reject, failure('UPLOAD_NETWORK'))
    )
    request.addEventListener('abort', () =>
      finish(reject, failure(stalled ? 'UPLOAD_STALLED' : 'UPLOAD_CANCELLED'))
    )
    const onAbort = () => request.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = clock.setInterval(() => {
      if (clock.now() - lastProgressAt < 45000) return
      stalled = true
      request.abort()
    }, 5000)
    function finish(callback, value) {
      if (settled) return
      settled = true
      clock.clearInterval(timer)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    try {
      request.send(blob)
    } catch {
      finish(reject, failure('UPLOAD_NETWORK'))
    }
  })
}
