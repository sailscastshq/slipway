const { Writable, Transform, PassThrough } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { Upload } = require('@aws-sdk/lib-storage')
const createClient = require('./s3-client')

// Source-owned implementation of the Skipper adapter contract, backed by AWS v3.
module.exports = function s3UploadAdapter(globalOptions = {}) {
  return {
    read(fd) {
      const client = createClient(globalOptions),
        controller = new AbortController(),
        output = new PassThrough()
      output.once('close', () => {
        controller.abort()
        client.destroy()
      })
      client
        .getObject(
          { Bucket: globalOptions.bucket, Key: key(fd) },
          { abortSignal: controller.signal }
        )
        .then((result) => pipeline(result.Body, output))
        .catch((error) => output.destroy(error))
      return output
    },
    rm(fd, done) {
      const client = createClient(globalOptions)
      client
        .deleteObject({ Bucket: globalOptions.bucket, Key: key(fd) })
        .then((result) => done(null, result), done)
        .finally(() => client.destroy())
    },
    ls(dirname, done) {
      const client = createClient(globalOptions)
      ;(async () => {
        const names = [],
          seen = new Set()
        let token
        do {
          const result = await client.listObjectsV2({
            Bucket: globalOptions.bucket,
            Prefix: String(dirname || '').replace(/^\/+/, ''),
            ContinuationToken: token
          })
          names.push(...(result.Contents || []).map((item) => item.Key))
          token = result.IsTruncated ? result.NextContinuationToken : undefined
          if (token && seen.has(token))
            throw new Error('Object storage repeated a listing cursor')
          if (token) seen.add(token)
        } while (token)
        return names
      })()
        .then((result) => done(null, result), done)
        .finally(() => client.destroy())
    },
    receive(localOptions = {}) {
      const options = { ...globalOptions, ...localOptions },
        client = createClient(options)
      let total = 0,
        active
      const receiver = new Writable({
        objectMode: true,
        write(file, encoding, done) {
          const fd = file.skipperFd || file.fd
          if (typeof fd !== 'string' || !fd)
            return done(new Error('Upload is missing its storage path'))
          let bytes = 0
          const limiter = new Transform({
            transform(chunk, encoding, next) {
              bytes += chunk.length
              total += chunk.length
              if (
                (options.maxBytes && total > options.maxBytes) ||
                (options.maxBytesPerFile && bytes > options.maxBytesPerFile)
              ) {
                const error = new Error('Upload exceeds its byte limit')
                error.code = 'E_EXCEEDS_UPLOAD_LIMIT'
                return next(error)
              }
              file.byteCount = bytes
              const progress = { fd, written: bytes }
              options.onProgress?.(progress)
              receiver.emit('progress', progress)
              next(null, chunk)
            }
          })
          const upload = new Upload({
            client,
            params: {
              Bucket: options.bucket,
              Key: key(fd),
              Body: limiter,
              ContentType:
                file.headers?.['content-type'] ||
                require('mime-types').lookup(fd) ||
                'application/octet-stream'
            },
            queueSize: 2,
            partSize: 5 * 1024 * 1024,
            leavePartsOnError: false
          })
          active = { file, limiter, upload }
          Promise.all([pipeline(file, limiter), upload.done()]).then(
            () => {
              active = null
              receiver.emit('writefile', file)
              done()
            },
            async (error) => {
              file.destroy()
              limiter.destroy()
              await upload.abort().catch(() => {})
              active = null
              done(error)
            }
          )
        },
        destroy(error, done) {
          if (active) {
            active.file.destroy()
            active.limiter.destroy()
            active.upload
              .abort()
              .catch(() => {})
              .finally(() => {
                client.destroy()
                done(error)
              })
          } else {
            client.destroy()
            done(error)
          }
        }
      })
      return receiver
    }
  }
}
function key(value) {
  if (typeof value !== 'string' || !value)
    throw new Error('Object key is required')
  return value.replace(/^\/+/, '')
}
