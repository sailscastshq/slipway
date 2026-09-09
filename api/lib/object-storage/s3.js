const { Upload } = require('@aws-sdk/lib-storage')
const createClient = require('../s3-client')
module.exports = function s3(config) {
  const client = createClient(config)
  return {
    async put(key, input, signal, created) {
      const placeholder = await client.putObject(
        { Bucket: config.bucket, Key: key, Body: '', IfNoneMatch: '*' },
        { abortSignal: signal }
      )
      created()
      const upload = new Upload({
        client,
        params: {
          Bucket: config.bucket,
          Key: key,
          Body: input,
          IfMatch: placeholder.ETag,
          ContentType: 'application/octet-stream'
        },
        queueSize: 2,
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false
      })
      const abort = () => {
        upload.abort().catch(() => {})
      }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      try {
        const result = await upload.done()
        return { etag: result.ETag, versionId: result.VersionId }
      } finally {
        signal.removeEventListener('abort', abort)
      }
    },
    async get(key, signal) {
      const result = await client.getObject(
        { Bucket: config.bucket, Key: key },
        { abortSignal: signal }
      )
      return {
        stream: result.Body,
        size: result.ContentLength,
        etag: result.ETag
      }
    },
    async delete(key, signal) {
      await client.deleteObject(
        { Bucket: config.bucket, Key: key },
        { abortSignal: signal }
      )
    },
    anonymousUrl(key) {
      const base = new URL(
        config.endpoint ||
          `https://s3.${config.region || 'us-east-1'}.amazonaws.com`
      )
      base.pathname =
        base.pathname.replace(/\/$/, '') +
        '/' +
        encodeURIComponent(config.bucket) +
        '/' +
        key.split('/').map(encodeURIComponent).join('/')
      base.search = ''
      return base.toString()
    },
    close() {
      client.destroy()
    }
  }
}
