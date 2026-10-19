module.exports = {
  friendlyName: 'Resolve Bridge direct upload session',

  description:
    'Reauthorize a direct-upload intent and load its current field and storage contract.',

  inputs: {
    actionName: { type: 'string' },
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
    actionName,
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
    const loaded = await sails.helpers.bridge.loadResource.with({
      containerName: app.containerName,
      environmentId: environment.id,
      modelIdentity,
      action: actionName || (recordId ? 'update' : 'create'),
      actor,
      ...(recordId ? { recordId } : {})
    })
    if (actionName) {
      if (
        !loaded.actionDefinition ||
        loaded.actionDefinition.scope === 'bulk'
      ) {
        const error = new Error('This Bridge upload action is not available.')
        error.code = 'BRIDGE_UPLOAD_FIELD_NOT_FOUND'
        throw error
      }
      const context = await sails.helpers.bridge.loadActionContext.with({
        containerName: app.containerName,
        resource: loaded.resource,
        action: loaded.actionDefinition,
        actor,
        recordId: loaded.recordId
      })
      loaded.actionDefinition = context.action
    }
    const surface = recordId ? 'edit' : 'create'
    const attribute = actionName
      ? loaded.actionDefinition.fields?.[fieldName]
      : loaded.resource.attributes?.[fieldName]
    const uploadResource = actionName
      ? `${loaded.resource.identity}.${loaded.actionDefinition.name}`
      : loaded.resource.identity
    if (
      !(actionName
        ? Object.hasOwn(loaded.actionDefinition.fields, fieldName)
        : loaded.resource[surface]?.includes(fieldName)) ||
      attribute?.field?.upload?.storage !== 'bridge'
    ) {
      const error = new Error('This Bridge upload field is not available.')
      error.code = 'BRIDGE_UPLOAD_FIELD_NOT_FOUND'
      throw error
    }

    const payload = await sails.helpers.bridge.verifyDirectUploadIntent.with({
      intent: uploadIntent,
      context: {
        actorId,
        projectId: project.id,
        environmentId: environment.id,
        appId: app.id,
        resource: uploadResource,
        field: fieldName
      }
    })
    const expectedRecordId =
      recordId === undefined || recordId === null ? null : String(recordId)
    if (payload.recordId !== expectedRecordId) {
      throw new Error('This upload session belongs to a different record.')
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
      uploadResource,
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
