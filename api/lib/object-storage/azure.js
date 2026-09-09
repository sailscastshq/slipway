const {
  BlobServiceClient,
  StorageSharedKeyCredential
} = require('@azure/storage-blob')
module.exports = function azure(config) {
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
