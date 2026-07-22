const fs = require('node:fs')

const createBackupStorageAdapter = require('../../lib/backup-storage-adapter')

module.exports = {
  friendlyName: 'Download backup object',

  description:
    'Stream an S3-compatible backup object to disk with a byte limit.',

  inputs: {
    s3Key: {
      type: 'string',
      required: true
    },
    destinationPath: {
      type: 'string',
      required: true
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
    signal: {
      type: 'ref',
      description: 'Optional AbortSignal.'
    },
    timeoutMs: {
      type: 'number',
      required: true,
      min: 1
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    s3Key,
    destinationPath,
    storageConfig,
    maxBytes,
    signal,
    timeoutMs
  }) {
    const adapter = createBackupStorageAdapter(storageConfig)

    try {
      return await sails.helpers.streams.copy.with({
        input: adapter.read(s3Key),
        output: fs.createWriteStream(destinationPath, { flags: 'wx' }),
        maxBytes,
        label: 'Downloaded backup',
        signal,
        timeoutMs
      })
    } catch (error) {
      error.message = `Backup download failed: ${error.message}`
      throw error
    }
  }
}
