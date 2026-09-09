const { Transform, Writable, Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { randomUUID, createHash } = require('node:crypto')
const limitStream = require('../byte-limit-transform')
const normalize = require('./errors')
function failure(code) {
  const error = new Error(code)
  error.code = code
  return error
}
module.exports = function objectStorage(config) {
  if (!config?.bucket || !config.provider)
    throw normalize(failure('STORAGE_CONFIGURATION'))
  function driver() {
    return require(config.provider === 'azure' ? './azure' : './s3')(config)
  }
  function key(value) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 1024 ||
      value.startsWith('/') ||
      /[\u0000-\u001f\\]/.test(value) ||
      value.split('/').includes('..')
    )
      throw normalize(failure('STORAGE_CONFIGURATION'))
    return value
  }
  async function operation(options, execute) {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs || 30000)
    const abort = () => controller.abort()
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    let adapter
    try {
      adapter = driver()
      controller.signal.throwIfAborted()
      return await execute(adapter, controller.signal)
    } catch (error) {
      throw normalize(timedOut ? failure('STREAM_TIMEOUT') : error)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      adapter?.close()
    }
  }
  async function privateAccess(adapter, objectKey, signal) {
    const urls = [adapter.anonymousUrl(objectKey)]
    if (config.publicUrl) {
      const publicUrl = new URL(config.publicUrl)
      publicUrl.pathname =
        publicUrl.pathname.replace(/\/$/, '') +
        '/' +
        objectKey.split('/').map(encodeURIComponent).join('/')
      publicUrl.search = ''
      urls.push(publicUrl.toString())
    }
    for (const url of urls) {
      let response
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          redirect: 'error',
          signal
        })
        if (response.ok) throw failure('STORAGE_PUBLIC')
        if (![401, 403, 404].includes(response.status))
          throw failure('STORAGE_PRIVACY_UNVERIFIED')
      } finally {
        await response?.body?.cancel().catch(() => {})
      }
    }
  }

  const api = {
    capabilities: {
      privatePut: true,
      privateGet: true,
      delete: true,
      publicUrl: false
    },
    async putObject({ objectKey, input, maxBytes, timeoutMs, signal }) {
      key(objectKey)
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw normalize(failure('STORAGE_CONFIGURATION'))
      const limiter = limitStream({ maxBytes, label: 'Backup upload' })
      const hash = createHash('sha256')
      const digest = new Transform({
        transform(chunk, encoding, next) {
          hash.update(chunk)
          next(null, chunk)
        }
      })
      // A provider can reject after the input pipeline has finished writing.
      // Keep late destroy(error) events handled; the upload promise still rejects.
      input.on('error', () => {})
      digest.on('error', () => {})
      return operation({ timeoutMs, signal }, async (adapter, abortSignal) => {
        let metadata,
          failureReason,
          owned = false
        const transfer = pipeline(input, limiter, digest, {
          signal: abortSignal
        }).catch((error) => {
          failureReason = error
          digest.destroy(error)
          throw error
        })
        try {
          const upload = adapter
            .put(objectKey, digest, abortSignal, () => {
              owned = true
            })
            .catch((error) => {
              input.destroy(error)
              digest.destroy(error)
              throw error
            })
          const results = await Promise.allSettled([transfer, upload])
          if (results.some((result) => result.status === 'rejected'))
            throw (
              failureReason ||
              results.find((result) => result.status === 'rejected').reason
            )
          metadata = results[1].value
          await privateAccess(adapter, objectKey, abortSignal)
          return {
            bytes: limiter.getBytes(),
            checksum: hash.digest('hex'),
            checksumAlgorithm: 'sha256',
            ...metadata
          }
        } catch (error) {
          input.destroy()
          digest.destroy()
          try {
            if (owned)
              await adapter.delete(objectKey, AbortSignal.timeout(10000))
          } catch {
            error.cleanupFailed = true
          }
          throw error
        }
      }).finally(() => {
        input.destroy()
        digest.destroy()
      })
    },
    async getObject({
      objectKey,
      output,
      maxBytes,
      timeoutMs,
      signal,
      checksum
    }) {
      key(objectKey)
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw normalize(failure('STORAGE_CONFIGURATION'))
      return operation({ timeoutMs, signal }, async (adapter, abortSignal) => {
        const object = await adapter.get(objectKey, abortSignal)
        const limiter = limitStream({ maxBytes, label: 'Backup download' })
        const hash = createHash('sha256')
        const digest = new Transform({
          transform(chunk, encoding, next) {
            hash.update(chunk)
            next(null, chunk)
          }
        })
        await pipeline(object.stream, limiter, digest, output, {
          signal: abortSignal
        })
        const actual = hash.digest('hex')
        if (checksum && checksum !== actual) throw failure('STORAGE_INTEGRITY')
        return {
          bytes: limiter.getBytes(),
          checksum: actual,
          etag: object.etag
        }
      })
    },
    async deleteObject({ objectKey, timeoutMs, signal }) {
      key(objectKey)
      return operation({ timeoutMs, signal }, (adapter, abortSignal) =>
        adapter.delete(objectKey, abortSignal)
      )
    },
    async testConnection({ signal, timeoutMs = 15000 } = {}) {
      const objectKey = `.slipway-check/${randomUUID()}`
      const bytes = Buffer.from(`Slipway private storage check ${randomUUID()}`)
      try {
        const uploaded = await api.putObject({
          objectKey,
          input: Readable.from([bytes]),
          maxBytes: 1024,
          timeoutMs,
          signal
        })
        const downloaded = await api.getObject({
          objectKey,
          output: new Writable({
            write(chunk, encoding, next) {
              next()
            }
          }),
          maxBytes: 1024,
          checksum: uploaded.checksum,
          timeoutMs,
          signal
        })
        if (downloaded.bytes !== bytes.length)
          throw normalize(failure('STORAGE_INTEGRITY'))
        await api.deleteObject({ objectKey, timeoutMs, signal })
        return { verified: true, capabilities: api.capabilities }
      } finally {
        await api.deleteObject({ objectKey, timeoutMs: 10000 }).catch(() => {})
      }
    }
  }
  return api
}
