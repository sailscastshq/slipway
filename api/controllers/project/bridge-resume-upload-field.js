module.exports = {
  friendlyName: 'Resume Bridge direct upload',

  description:
    'List authoritative uploaded parts and refresh short-lived URLs for the missing parts.',

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
    success: { description: 'The resumable upload state is ready.' },
    badRequest: { statusCode: 400 },
    forbidden: { statusCode: 403 },
    notFound: { statusCode: 404 }
  },

  fn: async function (inputs) {
    let session
    try {
      session = await sails.helpers.bridge.resolveDirectUploadSession.with({
        req: this.req,
        projectSlug: inputs.slug,
        environmentSlug: inputs.envSlug,
        ...(inputs.appSlug ? { appSlug: inputs.appSlug } : {}),
        modelIdentity: inputs.modelIdentity,
        fieldName: inputs.fieldName,
        ...(inputs.recordId ? { recordId: inputs.recordId } : {}),
        uploadIntent: inputs.uploadIntent
      })
    } catch (error) {
      throwSessionError(error)
    }

    const { payload, storage } = session
    try {
      if (payload.strategy === 'single') {
        const signed = await sails.helpers.bridge.directUploadStorage.with({
          operation: 'signPut',
          storage,
          objectPath: payload.objectPath,
          contentType: payload.fileType
        })
        return {
          strategy: 'single',
          method: 'PUT',
          uploadUrl: signed.uploadUrl,
          headers: { 'Content-Type': payload.fileType },
          expiresInSeconds: signed.expiresInSeconds
        }
      }

      let listed
      try {
        listed = await sails.helpers.bridge.directUploadStorage.with({
          operation: 'listParts',
          storage,
          objectPath: payload.objectPath,
          uploadId: payload.uploadId
        })
      } catch (error) {
        if (error.code !== 'BRIDGE_MULTIPART_UPLOAD_MISSING') throw error
        const completed = await completedObject(storage, payload)
        if (!completed) throw error
        return {
          strategy: 'multipart',
          completed: true,
          uploadedParts: [],
          parts: [],
          expiresInSeconds: 0
        }
      }
      const validParts = listed.parts.filter((part) =>
        isValidUploadedPart(part, payload)
      )
      const uploaded = new Set(validParts.map((part) => part.partNumber))
      const missing = Array.from(
        { length: payload.partCount },
        (_, index) => index + 1
      ).filter((partNumber) => !uploaded.has(partNumber))
      const signed = missing.length
        ? await sails.helpers.bridge.directUploadStorage.with({
            operation: 'signParts',
            storage,
            objectPath: payload.objectPath,
            uploadId: payload.uploadId,
            partNumbers: missing
          })
        : { parts: [], expiresInSeconds: 60 * 60 }
      return {
        strategy: 'multipart',
        completed: false,
        uploadedParts: validParts,
        parts: signed.parts,
        expiresInSeconds: signed.expiresInSeconds
      }
    } catch (error) {
      throw { badRequest: { message: error.message } }
    }
  }
}

async function completedObject(storage, payload) {
  try {
    const object = await sails.helpers.bridge.directUploadStorage.with({
      operation: 'head',
      storage,
      objectPath: payload.objectPath
    })
    return (
      object.size === payload.fileSize &&
      normalizeType(object.type) === normalizeType(payload.fileType)
    )
  } catch {
    return false
  }
}

function isValidUploadedPart(part, payload) {
  if (
    !Number.isInteger(part.partNumber) ||
    part.partNumber < 1 ||
    part.partNumber > payload.partCount ||
    !part.etag
  ) {
    return false
  }
  const expectedSize = Math.min(
    payload.partSize,
    payload.fileSize - (part.partNumber - 1) * payload.partSize
  )
  return part.size === expectedSize
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
