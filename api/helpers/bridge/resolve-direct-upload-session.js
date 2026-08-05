module.exports = {
  friendlyName: 'Resolve Bridge direct upload session',

  description:
    'Reauthorize a direct-upload intent and load its current field and storage contract.',

  inputs: {
    req: { type: 'ref', required: true },
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' },
    modelIdentity: { type: 'string', required: true },
    fieldName: { type: 'string', required: true },
    recordId: { type: 'string' },
    uploadIntent: { type: 'string', required: true, maxLength: 8192 }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({
    req,
    projectSlug,
    environmentSlug,
    appSlug,
    modelIdentity,
    fieldName,
    recordId,
    uploadIntent
  }) {
    const resolved = await sails.helpers.bridge.resolveRequest.with({
      req,
      projectSlug,
      environmentSlug,
      ...(appSlug ? { appSlug } : {}),
      requiredRole: 'editor',
      requireRunning: true
    })
    const { project, environment, app, actor, actorId } = resolved
    const payload = await sails.helpers.bridge.verifyDirectUploadIntent.with({
      intent: uploadIntent,
      context: {
        actorId,
        projectId: project.id,
        environmentId: environment.id,
        appId: app.id,
        resource: modelIdentity,
        field: fieldName
      }
    })
    const expectedRecordId =
      recordId === undefined || recordId === null ? null : String(recordId)
    if (payload.recordId !== expectedRecordId) {
      throw new Error('This upload session belongs to a different record.')
    }

    const loaded = await sails.helpers.bridge.loadResource.with({
      containerName: app.containerName,
      environmentId: environment.id,
      modelIdentity,
      action: recordId ? 'update' : 'create',
      actor,
      ...(recordId ? { recordId } : {})
    })
    const surface = recordId ? 'edit' : 'create'
    const attribute = loaded.resource.attributes?.[fieldName]
    if (
      !loaded.resource[surface]?.includes(fieldName) ||
      attribute?.field?.upload?.storage !== 'bridge'
    ) {
      const error = new Error('This Bridge upload field is not available.')
      error.code = 'BRIDGE_UPLOAD_FIELD_NOT_FOUND'
      throw error
    }

    const upload = attribute.field.upload
    if (
      payload.fileSize > upload.maxBytes ||
      !acceptsMimeType(payload.fileType, upload.accept)
    ) {
      throw new Error(
        'This upload no longer matches the Bridge field contract.'
      )
    }

    const storage = await sails.helpers.bridge.getUploadStorageConfig.with({
      app,
      environment
    })
    if (publicUrlFor(storage.publicUrl, payload.objectPath) !== payload.url) {
      throw new Error('This upload destination no longer matches the app.')
    }

    return {
      ...resolved,
      payload,
      loaded,
      attribute,
      upload,
      storage
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

function publicUrlFor(baseUrl, objectPath) {
  const encodedPath = objectPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${baseUrl.replace(/\/+$/, '')}/${encodedPath}`
}
