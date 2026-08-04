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
  friendlyName: 'Prepare Bridge direct upload',

  description:
    'Authorize a Bridge file and create a short-lived direct object-store upload URL.',

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
      type: 'ref',
      defaultsTo: {}
    },
    fileName: {
      type: 'string',
      required: true,
      maxLength: 512
    },
    fileType: {
      type: 'string',
      required: true,
      maxLength: 255
    },
    fileSize: {
      type: 'number',
      required: true,
      min: 1,
      max: 2 * 1024 * 1024 * 1024,
      isInteger: true
    }
  },

  exits: {
    success: {
      description: 'The direct upload is ready.'
    },
    badRequest: {
      statusCode: 400
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
    values,
    fileName,
    fileType,
    fileSize
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
        values
      })
    } catch (error) {
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
      throw {
        badRequest: {
          message:
            error.message === 'The target app is not running.'
              ? error.message
              : error.message || 'The upload could not be prepared.'
        }
      }
    }

    if (!acceptsMimeType(fileType, target.upload.accept)) {
      throw {
        badRequest: {
          message: `Choose a file matching: ${target.upload.accept.join(', ')}.`
        }
      }
    }
    if (fileSize > target.upload.maxBytes) {
      throw {
        badRequest: {
          message: `Files for ${target.attribute.label} must be ${formatBytes(
            target.upload.maxBytes
          )} or smaller.`
        }
      }
    }

    const extension = MIME_EXTENSIONS[fileType] || safeExtension(fileName)
    const uniqueId = crypto.randomUUID()
    const filename = target.configuredFilename
      ? `${target.configuredFilename}-${uniqueId}${extension}`
      : `${uniqueId}${extension}`
    const objectPath = [target.directory, filename].filter(Boolean).join('/')
    if (objectPath.length > 1024) {
      throw {
        badRequest: { message: 'The resolved Bridge upload path is too long.' }
      }
    }

    let uploadUrl
    let uploadReceipt
    const url = `${target.storage.publicUrl.replace(/\/$/, '')}/${objectPath}`
    try {
      uploadUrl = await sails.helpers.bridge.createDirectUploadUrl.with({
        storage: target.storage,
        objectPath,
        contentType: fileType
      })
      uploadReceipt = await sails.helpers.bridge.createUploadReceipt.with({
        url,
        context: {
          actorId: target.actorId,
          projectId: target.project.id,
          environmentId: target.environment.id,
          resource: target.loaded.resource.identity,
          field: fieldName
        },
        expiresInMs: 20 * 60 * 1000
      })
    } catch (error) {
      throw {
        badRequest: {
          message: error.message || 'The upload could not be prepared.'
        }
      }
    }

    return {
      method: 'PUT',
      uploadUrl,
      headers: {
        'Content-Type': fileType
      },
      url,
      uploadReceipt,
      expiresInSeconds: 15 * 60
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

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}
