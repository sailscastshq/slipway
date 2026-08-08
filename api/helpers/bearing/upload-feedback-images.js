const crypto = require('node:crypto')

const IMAGE_EXTENSIONS = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

module.exports = {
  friendlyName: 'Upload Bearing images',

  description:
    'Stream images into Slipway-owned object storage under one app-scoped Bearing path.',

  inputs: {
    req: {
      type: 'ref'
    },
    upstream: {
      type: 'ref'
    },
    storage: {
      type: 'ref',
      required: true
    },
    directory: {
      type: 'string',
      required: true,
      maxLength: 1024
    },
    fields: {
      type: 'json',
      defaultsTo: []
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ req, upstream, storage, directory, fields }) {
    const publicBase = normalizePublicBase(storage.publicUrl)
    if (!publicBase) {
      const error = new Error(
        'Image uploads need a public file URL. Add one in Settings → File storage.'
      )
      error.code = 'BEARING_UPLOAD_PUBLIC_URL_REQUIRED'
      throw error
    }
    const normalizedDirectory = normalizeDirectory(directory)
    const normalizedFields = normalizeFields(fields)
    if (upstream && normalizedFields.length) {
      const error = new Error('Bearing received two upload sources.')
      error.code = 'BEARING_UPLOAD_SOURCE_INVALID'
      throw error
    }
    if (!upstream && (!req || typeof req.file !== 'function')) {
      const error = new Error('Choose an image to upload.')
      error.code = 'BEARING_UPLOAD_SOURCE_INVALID'
      throw error
    }

    const uploads = (
      upstream
        ? [{ upstream, field: 'image' }]
        : normalizedFields.map((field) => ({ field }))
    ).map(({ upstream: selectedUpstream, field }) =>
      uploadField({
        req,
        upstream: selectedUpstream,
        field,
        storage,
        directory: normalizedDirectory,
        publicBase
      })
    )
    const results = await Promise.allSettled(uploads)
    const uploaded = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value)
    const failed = results.find((result) => result.status === 'rejected')

    if (failed) {
      if (uploaded.length) {
        await sails.helpers.bearing.deleteFeedbackImages
          .with({ storage, images: uploaded })
          .catch((cleanupError) => {
            sails.log.warn(
              `Could not clean up a partial Bearing upload: ${cleanupError.message}`
            )
          })
      }
      throw failed.reason
    }

    const expectedCount = upstream ? 1 : normalizedFields.length
    if (uploaded.length !== expectedCount) {
      if (uploaded.length) {
        await sails.helpers.bearing.deleteFeedbackImages.with({
          storage,
          images: uploaded
        })
      }
      const error = new Error('Attach no more than 4 images.')
      error.code = 'BEARING_UPLOAD_COUNT_INVALID'
      throw error
    }

    return uploaded
  }
}

function uploadField({ req, upstream, field, storage, directory, publicBase }) {
  return new Promise((resolve, reject) => {
    const source = upstream || req.file(field)
    source.upload(
      {
        adapter: require('skipper-s3'),
        key: storage.key,
        secret: storage.secret,
        bucket: storage.bucket,
        endpoint: storage.endpoint,
        region: storage.region || 'auto',
        dirname: directory,
        maxBytes: MAX_IMAGE_BYTES,
        saveAs: (incoming, proceed) => {
          const extension = IMAGE_EXTENSIONS[incoming.type]
          if (!extension) {
            const error = new Error(
              'Choose an AVIF, GIF, JPEG, PNG, or WebP image.'
            )
            error.code = 'BEARING_UPLOAD_TYPE_NOT_ALLOWED'
            proceed(error)
            return
          }
          proceed(null, `${crypto.randomUUID()}.${extension}`)
        }
      },
      (error, files) => {
        if (error) {
          reject(normalizeUploadError(error))
          return
        }

        resolve(
          (files || []).map((file) => {
            const fileName = String(file.fd).split('/').pop()
            const objectPath = `${directory}/${fileName}`
            return {
              url: `${publicBase}/${objectPath}`,
              objectPath,
              name: fileName,
              size: file.size,
              type: file.type
            }
          })
        )
      }
    )
  })
}

function normalizeUploadError(error) {
  if (error.code === 'E_EXCEEDS_UPLOAD_LIMIT') {
    const uploadError = new Error('Each image must be 5 MB or smaller.')
    uploadError.code = 'BEARING_UPLOAD_TOO_LARGE'
    return uploadError
  }
  return error
}

function normalizePublicBase(value) {
  try {
    const url = new URL(String(value || ''))
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function normalizeDirectory(value) {
  const segments = String(value || '').split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || !/^[A-Za-z0-9._-]+$/.test(segment))
  ) {
    const error = new Error('Bearing generated an invalid upload path.')
    error.code = 'BEARING_UPLOAD_PATH_INVALID'
    throw error
  }
  return segments.join('/')
}

function normalizeFields(value) {
  const fields = Array.isArray(value) ? value : []
  if (
    fields.length > 4 ||
    new Set(fields).size !== fields.length ||
    fields.some((field) => !/^(?:image|image[0-3])$/.test(field))
  ) {
    const error = new Error('Bearing received an invalid image selection.')
    error.code = 'BEARING_UPLOAD_FIELDS_INVALID'
    throw error
  }
  return fields
}

module.exports._private = {
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  normalizeDirectory,
  normalizeFields,
  normalizePublicBase,
  normalizeUploadError
}
