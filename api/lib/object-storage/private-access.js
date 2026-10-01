// Never include endpoint URLs, response messages, or credentials in diagnostics.
module.exports = async function verifyPrivateAccess(
  config,
  adapter,
  key,
  signal
) {
  const targets = []
  if (config.publicUrl) {
    const url = new URL(config.publicUrl)
    url.pathname =
      url.pathname.replace(/\/$/, '') +
      '/' +
      key.split('/').map(encodeURIComponent).join('/')
    url.search = ''
    targets.push({ url: url.toString(), role: 'public delivery' })
  }
  targets.push({ url: adapter.anonymousUrl(key), role: 'storage API' })
  let inconclusive
  for (const target of targets) {
    let response
    try {
      response = await fetch(target.url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        redirect: 'manual',
        signal
      })
      if (response.ok)
        throw diagnostic('STORAGE_PUBLIC', target.role, response.status)
      if (![401, 403, 404].includes(response.status)) {
        const error = diagnostic(
          'STORAGE_PRIVACY_UNVERIFIED',
          target.role,
          response.status
        )
        error.providerCode = await readErrorCode(response)
        inconclusive ||= error
      }
    } catch (error) {
      if (error.code === 'STORAGE_PUBLIC') throw error
      if (signal?.aborted) throw error
      inconclusive ||=
        error.code === 'STORAGE_PRIVACY_UNVERIFIED'
          ? error
          : diagnostic('STORAGE_PRIVACY_UNVERIFIED', target.role)
    } finally {
      await response?.body?.cancel().catch(() => {})
    }
  }
  if (inconclusive) throw inconclusive
}

function diagnostic(code, role, status) {
  const error = new Error(code)
  Object.assign(error, { code, probeRole: role, probeStatus: status })
  return error
}

async function readErrorCode(response) {
  if (!response.body) return undefined
  const reader = response.body.getReader()
  let size = 0
  const chunks = []
  try {
    while (size < 4096) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value).subarray(0, 4096 - size)
      chunks.push(chunk)
      size += chunk.length
    }
    return Buffer.concat(chunks)
      .toString('utf8')
      .match(/<Code>([A-Za-z][A-Za-z0-9]{0,63})<\/Code>/)?.[1]
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
