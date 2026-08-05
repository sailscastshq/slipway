const crypto = require('node:crypto')
const path = require('node:path')

const MIME_EXTENSIONS = {
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm'
}

module.exports = {
  friendlyName: 'Upload Bridge field',

  description:
    'Stream a configured Bridge file field to app-scoped object storage.',

  files: ['file'],

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    appSlug: {
      type: 'string'
    },
    modelIdentity: {
      type: 'string',
      required: true
    },
    fieldName: {
      type: 'string',
      required: true
    },
    recordId: {
      type: 'string'
    },
    values: {
      type: 'string',
      defaultsTo: '{}'
    },
    file: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      description: 'The configured Bridge field was uploaded.'
    },
    badRequest: {
      statusCode: 400
    },
    reauthenticate: {
      responseType: 'bridgeReauthenticate'
    },
    forbidden: {
      statusCode: 403
    },
    notFound: {
      statusCode: 404
    }
  },

  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    fieldName,
    recordId,
    values
  }) {
    let target
    try {
      target = await sails.helpers.bridge.prepareUploadTarget.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        ...(appSlug ? { appSlug } : {}),
        modelIdentity,
        fieldName,
        ...(recordId ? { recordId } : {}),
        values: parseUploadValues(values)
      })
    } catch (error) {
      if (error.code === 'reauthenticate') {
        throw { reauthenticate: error.raw || error }
      }
      if (error.code === 'forbidden') {
        throw {
          forbidden: { message: 'Your Bridge role cannot upload files.' }
        }
      }
      if (
        error.code === 'notFound' ||
        error.code === 'BRIDGE_UPLOAD_FIELD_NOT_FOUND'
      ) {
        throw { notFound: { message: error.message } }
      }
      throw { badRequest: { message: error.message } }
    }

    const {
      project,
      environment,
      actorId,
      loaded,
      attribute,
      upload,
      storage,
      directory,
      configuredFilename
    } = target
    const objectId = crypto.randomUUID()

    const uploadedFiles = await new Promise((resolve, reject) => {
      this.req.file('file').upload(
        {
          adapter: require('skipper-s3'),
          key: storage.key,
          secret: storage.secret,
          bucket: storage.bucket,
          endpoint: storage.endpoint,
          region: storage.region || 'us-east-1',
          dirname: directory,
          maxBytes: upload.maxBytes,
          saveAs: (incoming, proceed) => {
            if (!acceptsMimeType(incoming.type, upload.accept)) {
              proceed(
                new Error(
                  `Choose a file matching: ${upload.accept.join(', ')}.`
                )
              )
              return
            }
            const extension =
              MIME_EXTENSIONS[incoming.type] ||
              safeExtension(incoming.filename || '')
            const stem = configuredFilename
              ? `${configuredFilename}-${objectId}`
              : objectId
            proceed(null, `${stem}${extension}`)
          }
        },
        (error, files) => {
          if (error) reject(error)
          else resolve(files)
        }
      )
    }).catch((error) => {
      throw {
        badRequest: {
          message:
            error.code === 'E_EXCEEDS_UPLOAD_LIMIT'
              ? `Files for ${attribute.label} must be ${formatBytes(
                  upload.maxBytes
                )} or smaller.`
              : error.message || 'The file could not be uploaded.'
        }
      }
    })

    if (!uploadedFiles?.length) {
      throw { badRequest: { message: 'Choose a file to upload.' } }
    }

    const fileName = String(uploadedFiles[0].fd).split('/').pop()
    const objectPath = [directory, fileName].filter(Boolean).join('/')
    const url = `${storage.publicUrl.replace(/\/$/, '')}/${objectPath}`
    const receipt = await sails.helpers.bridge.createUploadReceipt.with({
      url,
      context: {
        actorId,
        projectId: project.id,
        environmentId: environment.id,
        resource: loaded.resource.identity,
        field: fieldName
      }
    })

    return {
      url,
      receipt,
      file: {
        name: uploadedFiles[0].filename,
        size: uploadedFiles[0].size,
        type: uploadedFiles[0].type
      }
    }
  }
}

function acceptsMimeType(type, accepted) {
  if (!Array.isArray(accepted) || accepted.length === 0) return true
  return accepted.some((candidate) => {
    if (candidate.endsWith('/*')) {
      return type.startsWith(candidate.slice(0, -1))
    }
    return type === candidate
  })
}

function safeExtension(filename) {
  const extension = path.extname(filename).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''
}

function parseUploadValues(value) {
  if (value === undefined || value === null || value === '') value = '{}'
  if (typeof value !== 'string' || value.length > 64 * 1024) {
    throw new Error('Bridge upload context is invalid.')
  }

  let parsed
  try {
    parsed = JSON.parse(value || '{}')
  } catch {
    throw new Error('Bridge upload context is invalid.')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(parsed))
  ) {
    throw new Error('Bridge upload context is invalid.')
  }
  return parsed
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}
