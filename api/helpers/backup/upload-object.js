const fs = require('node:fs')
const path = require('node:path')

const createBackupStorageAdapter = require('../../lib/backup-storage-adapter')

module.exports = {
  friendlyName: 'Upload backup object',

  description:
    'Stream a backup file into S3-compatible storage with bounded size and duration.',

  inputs: {
    sourcePath: {
      type: 'string',
      required: true
    },
    s3Key: {
      type: 'string',
      required: true
    },
    sizeBytes: {
      type: 'number',
      required: true,
      min: 1
    },
    storageConfig: {
      type: 'ref',
      required: true
    },
    maxBytes: {
      type: 'number',
      required: true,
      min: 1
    },
    timeoutMs: {
      type: 'number',
      required: true,
      min: 1
    },
    signal: {
      type: 'ref',
      description: 'Optional AbortSignal.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    sourcePath,
    s3Key,
    sizeBytes,
    storageConfig,
    maxBytes,
    timeoutMs,
    signal
  }) {
    if (sizeBytes > maxBytes) {
      throw new Error(`Backup upload exceeds its ${maxBytes}-byte limit.`)
    }

    const adapter = createBackupStorageAdapter(storageConfig)
    const receiver = adapter.receive({
      dirname: '',
      saveAs: s3Key,
      maxBytes,
      maxBytesPerFile: maxBytes
    })
    const input = fs.createReadStream(sourcePath)

    input.skipperFd = s3Key
    input.filename = path.basename(s3Key)
    input.headers = { 'content-type': 'application/octet-stream' }
    input.byteCount = sizeBytes

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (signal) signal.removeEventListener('abort', onAbort)

        if (error) {
          error.message = `Backup upload failed: ${error.message}`
          reject(error)
        } else {
          resolve({ bytes: sizeBytes })
        }
      }
      const stop = (error) => {
        input.destroy()
        receiver.destroy()
        finish(error)
      }
      const onAbort = () => {
        const error = new Error('Backup upload was cancelled.')
        error.code = 'STREAM_ABORTED'
        stop(error)
      }
      const timeout = setTimeout(() => {
        const error = new Error(`Backup upload timed out after ${timeoutMs}ms.`)
        error.code = 'STREAM_TIMEOUT'
        stop(error)
      }, timeoutMs)
      timeout.unref()

      receiver.once('error', (error) => {
        input.destroy()
        finish(error)
      })
      receiver.once('finish', () => finish())
      input.once('error', (error) => {
        receiver.destroy()
        finish(error)
      })

      if (signal) {
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })
      }

      receiver.end(input)
    })
  }
}
