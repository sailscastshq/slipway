module.exports = {
  friendlyName: 'Abort Bridge direct upload',

  description:
    'Abort an incomplete multipart upload after explicit cancellation.',

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
    success: { description: 'The upload was cancelled.' },
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
      if (error.code === 'forbidden') {
        throw {
          forbidden: { message: 'Your Bridge role cannot upload files.' }
        }
      }
      throw { badRequest: { message: error.message } }
    }

    if (session.payload.strategy === 'multipart') {
      try {
        await sails.helpers.bridge.directUploadStorage.with({
          operation: 'abortMultipart',
          storage: session.storage,
          objectPath: session.payload.objectPath,
          uploadId: session.payload.uploadId
        })
      } catch (error) {
        if (error.code !== 'BRIDGE_MULTIPART_UPLOAD_MISSING') {
          throw { badRequest: { message: error.message } }
        }
      }
    }
    return { aborted: true }
  }
}
