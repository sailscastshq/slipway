module.exports = {
  friendlyName: 'Complete Bridge direct upload',

  description:
    'Complete a direct upload and verify exact object metadata before issuing a field receipt.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' },
    modelIdentity: { type: 'string', required: true },
    fieldName: { type: 'string', required: true },
    recordId: { type: 'string' },
    uploadIntent: { type: 'string', required: true, maxLength: 8192 }
  },

  exits: {
    success: { description: 'The directly uploaded object was verified.' },
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
    uploadIntent
  }) {
    let session
    try {
      session = await sails.helpers.bridge.resolveDirectUploadSession.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        ...(appSlug ? { appSlug } : {}),
        modelIdentity,
        fieldName,
        ...(recordId ? { recordId } : {}),
        uploadIntent
      })
    } catch (error) {
      throwSessionError(error)
    }

    const { payload, storage } = session
    try {
      if (payload.strategy === 'multipart') {
        try {
          const listed = await sails.helpers.bridge.directUploadStorage.with({
            operation: 'listParts',
            storage,
            objectPath: payload.objectPath,
            uploadId: payload.uploadId
          })
          assertCompleteParts(listed.parts, payload)
          await sails.helpers.bridge.directUploadStorage.with({
            operation: 'completeMultipart',
            storage,
            objectPath: payload.objectPath,
            uploadId: payload.uploadId,
            parts: listed.parts
          })
        } catch (error) {
          if (error.code !== 'BRIDGE_MULTIPART_UPLOAD_MISSING') throw error
          // Completion is idempotent: when the response was lost, the upload ID
          // is gone but the exact completed object is still authoritative.
        }
      }

      const verified = await sails.helpers.bridge.directUploadStorage.with({
        operation: 'head',
        storage,
        objectPath: payload.objectPath
      })
      if (
        verified.size !== payload.fileSize ||
        normalizeType(verified.type) !== normalizeType(payload.fileType)
      ) {
        throw new Error(
          'The stored object does not match the selected file. Choose it again.'
        )
      }

      const receipt = await sails.helpers.bridge.createUploadReceipt.with({
        url: payload.url,
        context: {
          actorId: session.actorId,
          projectId: session.project.id,
          environmentId: session.environment.id,
          resource: session.loaded.resource.identity,
          field: fieldName
        }
      })
      return {
        url: payload.url,
        receipt,
        file: {
          name: payload.objectPath.split('/').pop(),
          size: verified.size,
          type: verified.type,
          etag: verified.etag
        }
      }
    } catch (error) {
      throw {
        badRequest: {
          message:
            error.message ||
            'Bridge could not verify the uploaded object. Please retry.'
        }
      }
    }
  }
}

function assertCompleteParts(parts, payload) {
  if (!Array.isArray(parts) || parts.length !== payload.partCount) {
    throw new Error(
      `Upload is incomplete: ${parts?.length || 0} of ${
        payload.partCount
      } parts arrived.`
    )
  }
  let bytes = 0
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const expectedSize = Math.min(
      payload.partSize,
      payload.fileSize - index * payload.partSize
    )
    if (
      part.partNumber !== index + 1 ||
      part.size !== expectedSize ||
      !part.etag
    ) {
      throw new Error(`Upload part ${index + 1} is incomplete or invalid.`)
    }
    bytes += part.size
  }
  if (bytes !== payload.fileSize) {
    throw new Error('The uploaded byte count does not match the selected file.')
  }
}

function throwSessionError(error) {
  if (error.code === 'forbidden') {
    throw { forbidden: { message: 'Your Bridge role cannot upload files.' } }
  }
  if (
    error.code === 'notFound' ||
    error.code === 'BRIDGE_UPLOAD_FIELD_NOT_FOUND'
  ) {
    throw { notFound: { message: error.message } }
  }
  throw { badRequest: { message: error.message } }
}

function normalizeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}
