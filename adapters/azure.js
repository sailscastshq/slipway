const { Writable, PassThrough } = require('node:stream')
const { pipeline } = require('node:stream/promises')

// Skipper adapter used by sails-hook-uploads for private Azure backup storage.
module.exports = function azureAdapter(options) {
  const storage = azure(options)
  return {
    receive(local = {}) {
      const settings = { ...options, ...local }
      const controller = new AbortController()
      let active
      const receiver = new Writable({
        objectMode: true,
        write(file, encoding, done) {
          active = file
          storage
            .put(
              file.skipperFd,
              file,
              controller.signal,
              settings.onCreated || (() => {})
            )
            .then((metadata) => {
              settings.onStored?.(metadata)
              done()
            }, done)
        },
        destroy(error, done) {
          controller.abort()
          active?.destroy(error)
          settings.signal?.removeEventListener('abort', abort)
          done(error)
        }
      })
      const abort = () => receiver.destroy(settings.signal.reason)
      if (settings.signal?.aborted) queueMicrotask(abort)
      else settings.signal?.addEventListener('abort', abort, { once: true })
      return receiver
    },
    read(fd) {
      const output = new PassThrough()
      const controller = new AbortController()
      const abort = () => output.destroy(options.signal.reason)
      output.once('close', () => {
        controller.abort()
        options.signal?.removeEventListener('abort', abort)
      })
      if (options.signal?.aborted) queueMicrotask(abort)
      else options.signal?.addEventListener('abort', abort, { once: true })
      storage
        .get(fd, controller.signal)
        .then((result) => {
          output.storageMetadata = { size: result.size, etag: result.etag }
          return pipeline(result.stream, output)
        })
        .catch((error) => output.destroy(error))
      return output
    },
    rm(fd, done) {
      storage.delete(fd, options.signal).then(() => done(), done)
    }
  }
}
const {
  BlobServiceClient,
  StorageSharedKeyCredential
} = require('@azure/storage-blob')
function azure(config) {
  const endpoint = (
    config.endpoint || `https://${config.account}.blob.core.windows.net`
  ).replace(/\/$/, '')
  const client = config.sasToken
    ? new BlobServiceClient(
        `${endpoint}?${config.sasToken.replace(/^\?/, '')}`,
        undefined,
        { retryOptions: { maxTries: 2, tryTimeoutInMs: 30000 } }
      )
    : new BlobServiceClient(
        endpoint,
        new StorageSharedKeyCredential(config.account, config.accountKey),
        { retryOptions: { maxTries: 2, tryTimeoutInMs: 30000 } }
      )
  const container = client.getContainerClient(config.bucket)
  return {
    async put(key, input, signal, created) {
      const blob = container.getBlockBlobClient(key)
      // Commit an empty private object first so cancellation can remove staged blocks.
      const placeholder = await blob.upload('', 0, {
        abortSignal: signal,
        conditions: { ifNoneMatch: '*' }
      })
      created()
      // The source may fail while the placeholder request is in flight.
      // Azure's stream scheduler does not observe errors emitted before it starts.
      signal.throwIfAborted()
      if (input.destroyed)
        throw input.errored || new Error('Upload source closed')
      const result = await blob.uploadStream(input, 4 * 1024 * 1024, 2, {
        abortSignal: signal,
        conditions: { ifMatch: placeholder.etag },
        blobHTTPHeaders: { blobContentType: 'application/octet-stream' }
      })
      return { etag: result.etag, versionId: result.versionId }
    },
    async get(key, signal) {
      const result = await container
        .getBlobClient(key)
        .download(0, undefined, { abortSignal: signal })
      return {
        stream: result.readableStreamBody,
        size: result.contentLength,
        etag: result.etag
      }
    },
    async delete(key, signal) {
      await container
        .getBlobClient(key)
        .deleteIfExists({ abortSignal: signal, deleteSnapshots: 'include' })
    },
    anonymousUrl(key) {
      const url = new URL(container.getBlobClient(key).url)
      url.search = ''
      return url.toString()
    },
    close() {}
  }
}
