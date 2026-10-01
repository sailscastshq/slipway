const { Transform, Writable, Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { randomUUID, createHash } = require('node:crypto')
const limitStream = require('../../lib/byte-limit-transform')
const normalize = require('../../../adapters/storage-error')

function failure(code) {
  const error = new Error(code)
  error.code = code
  return error
}
module.exports = {
  friendlyName: 'Get private backup storage',
  sync: true,
  inputs: { configuration: { type: 'ref', required: true } },
  exits: { success: { outputType: 'ref' } },
  fn: ({ configuration }) => objectStorage(configuration)
}
function objectStorage(config) {
  if (!config?.bucket || !config.provider)
    throw normalize(failure('STORAGE_CONFIGURATION'))
  function driver() {
    const factory = require(config.provider === 'azure'
      ? '../../../adapters/azure'
      : '../../../adapters/s3')
    function options(signal, extra = {}) {
      return { ...config, adapter: factory, signal, ...extra }
    }
    return {
      async put(objectKey, input, signal, created) {
        let metadata
        await sails.uploadOne(
          input,
          options(signal, {
            saveAs: objectKey,
            createOnly: true,
            onCreated: created,
            onStored: (value) => {
              metadata = value
            }
          })
        )
        return metadata
      },
      async get(objectKey, signal) {
        const stream = await sails.startDownload(objectKey, options(signal))
        return { stream, ...stream.storageMetadata }
      },
      delete(objectKey, signal) {
        return sails.rm(objectKey, options(signal))
      },
      anonymousUrl(objectKey) {
        const endpoint =
          config.endpoint ||
          (config.provider === 'azure'
            ? `https://${config.account}.blob.core.windows.net`
            : `https://s3.${config.region || 'us-east-1'}.amazonaws.com`)
        const url = new URL(endpoint)
        url.pathname =
          url.pathname.replace(/\/$/, '') +
          '/' +
          encodeURIComponent(config.bucket) +
          '/' +
          objectKey.split('/').map(encodeURIComponent).join('/')
        url.search = ''
        return url.toString()
      }
    }
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
          await sails.helpers.backup.verifyPrivateAccess.with({
            configuration: config,
            adapter,
            objectKey,
            signal: abortSignal
          })
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
