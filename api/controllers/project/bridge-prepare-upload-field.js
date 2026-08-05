const crypto = require('node:crypto')
const path = require('node:path')

const MIB = 1024 * 1024
const DEFAULT_PART_SIZE = 16 * MIB
const MULTIPART_THRESHOLD = 16 * MIB
const MAX_PARTS = 10_000
const SIGNED_URL_SECONDS = 60 * 60

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
    'Authorize a Bridge file and create a resumable direct object-store upload.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' },
    modelIdentity: { type: 'string', required: true },
    fieldName: { type: 'string', required: true },
    recordId: { type: 'string' },
    values: { type: 'ref', defaultsTo: {} },
    fileName: { type: 'string', required: true, maxLength: 512 },
    fileType: { type: 'string', required: true, maxLength: 255 },
    fileSize: {
      type: 'number',
      required: true,
      min: 1,
      max: 2 * 1024 * 1024 * 1024,
      isInteger: true
    }
  },

  exits: {
    success: { description: 'The direct upload is ready.' },
    badRequest: { statusCode: 400 },
    forbidden: { statusCode: 403 },
    notFound: { statusCode: 404 }
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
    const normalizedType = normalizeType(fileType)
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
      throwTargetError(error)
    }

    if (!acceptsMimeType(normalizedType, target.upload.accept)) {
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

    const extension = MIME_EXTENSIONS[normalizedType] || safeExtension(fileName)
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

    const url = publicUrlFor(target.storage.publicUrl, objectPath)
    const strategy = fileSize > MULTIPART_THRESHOLD ? 'multipart' : 'single'
    const partSize = strategy === 'multipart' ? choosePartSize(fileSize) : null
    const partCount = partSize ? Math.ceil(fileSize / partSize) : null
    let uploadId = null

    try {
      if (strategy === 'multipart') {
        const created = await sails.helpers.bridge.directUploadStorage.with({
          operation: 'createMultipart',
          storage: target.storage,
          objectPath,
          contentType: normalizedType
        })
        uploadId = created.uploadId
      }

      const uploadIntent =
        await sails.helpers.bridge.createDirectUploadIntent.with({
          context: {
            actorId: target.actorId,
            projectId: target.project.id,
            environmentId: target.environment.id,
            appId: target.app.id,
            resource: target.loaded.resource.identity,
            field: fieldName
          },
          upload: {
            strategy,
            url,
            objectPath,
            fileSize,
            fileType: normalizedType,
            recordId: recordId || null,
            uploadId,
            partSize,
            partCount
          }
        })

      if (strategy === 'single') {
        const signed = await sails.helpers.bridge.directUploadStorage.with({
          operation: 'signPut',
          storage: target.storage,
          objectPath,
          contentType: normalizedType,
          expiresInSeconds: SIGNED_URL_SECONDS
        })
        return {
          strategy,
          method: 'PUT',
          uploadUrl: signed.uploadUrl,
          headers: { 'Content-Type': normalizedType },
          url,
          uploadIntent,
          expiresInSeconds: signed.expiresInSeconds
        }
      }

      const signed = await sails.helpers.bridge.directUploadStorage.with({
        operation: 'signParts',
        storage: target.storage,
        objectPath,
        uploadId,
        partNumbers: partNumbers(partCount),
        expiresInSeconds: SIGNED_URL_SECONDS
      })
      return {
        strategy,
        url,
        uploadIntent,
        partSize,
        partCount,
        parts: signed.parts,
        expiresInSeconds: signed.expiresInSeconds
      }
    } catch (error) {
      if (uploadId) {
        await sails.helpers.bridge.directUploadStorage
          .with({
            operation: 'abortMultipart',
            storage: target.storage,
            objectPath,
            uploadId
          })
          .catch(() => {})
      }
      throw {
        badRequest: {
          message: error.message || 'The upload could not be prepared.'
        }
      }
    }
  }
}

function choosePartSize(fileSize) {
  const required = Math.ceil(fileSize / MAX_PARTS)
  const rounded = Math.ceil(required / MIB) * MIB
  return Math.max(DEFAULT_PART_SIZE, rounded)
}

function partNumbers(count) {
  return Array.from({ length: count }, (_, index) => index + 1)
}

function throwTargetError(error) {
  if (error.code === 'forbidden') {
    throw { forbidden: { message: 'Your Bridge role cannot upload files.' } }
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

function acceptsMimeType(type, accepted) {
  if (!Array.isArray(accepted) || accepted.length === 0) return true
  return accepted.some((candidate) =>
    candidate.endsWith('/*')
      ? type.startsWith(candidate.slice(0, -1))
      : type === candidate
  )
}

function safeExtension(filename) {
  const extension = path.extname(filename).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''
}

function normalizeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}

function publicUrlFor(baseUrl, objectPath) {
  const encodedPath = objectPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${baseUrl.replace(/\/+$/, '')}/${encodedPath}`
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}
