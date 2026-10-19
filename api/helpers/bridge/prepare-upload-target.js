module.exports = {
  friendlyName: 'Prepare Bridge upload target',

  description:
    'Authorize a Bridge upload field and resolve its scoped object-store directory.',

  inputs: {
    actionName: { type: 'string' },
    req: {
      type: 'ref',
      required: true
    },
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
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
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
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
    values
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
    const fieldType = attribute?.field?.type
    if (
      !(actionName
        ? Object.hasOwn(loaded.actionDefinition.fields, fieldName)
        : loaded.resource[surface]?.includes(fieldName)) ||
      !(
        ['file', 'image', 'upload'].includes(fieldType) ||
        (fieldType === 'richtext' &&
          attribute.field.format?.toLowerCase() === 'markdown' &&
          attribute.field.upload?.kind === 'image')
      ) ||
      attribute.field.upload?.storage !== 'bridge'
    ) {
      const error = new Error('This Bridge upload field is not available.')
      error.code = 'BRIDGE_UPLOAD_FIELD_NOT_FOUND'
      throw error
    }

    if (
      actionName &&
      !sails.helpers.bridge.matchesActionConditions.with({
        condition: attribute.visibleWhen,
        form: values,
        scope: 'form'
      })
    ) {
      const error = new Error('This Bridge upload field is not available.')
      error.code = 'BRIDGE_UPLOAD_FIELD_NOT_FOUND'
      throw error
    }

    const storage = await sails.helpers.bridge.getUploadStorageConfig.with({
      app,
      environment
    })
    const upload = attribute.field.upload

    await sails.helpers.bridge.authorizeRelationshipValues.with({
      containerName: app.containerName,
      environmentId: environment.id,
      resource: loaded.resource,
      actor,
      values: actionName && recordId ? {} : values
    })
    const objectPathConfig =
      await sails.helpers.bridge.resolveUploadObjectPath.with({
        containerName: app.containerName,
        resource: loaded.resource,
        resources: loaded.contract?.models || {
          [loaded.resource.identity]: loaded.resource
        },
        upload,
        values: actionName && recordId ? {} : values,
        ...(recordId ? { recordId: loaded.recordId } : {})
      })

    const namespace =
      upload.scope === 'bucket'
        ? []
        : [
            'bridge',
            `teams/${safeSegment(project.team)}`,
            `projects/${safeSegment(project.id)}`,
            `environments/${safeSegment(environment.id)}`,
            safeSegment(loaded.resource.identity),
            safeSegment(fieldName)
          ]
    const directory = [...namespace, objectPathConfig.directory]
      .filter(Boolean)
      .join('/')

    return {
      project,
      environment,
      app,
      actor,
      actorId,
      loaded,
      uploadResource,
      attribute,
      upload,
      storage,
      surface,
      directory,
      configuredFilename: objectPathConfig.filename || ''
    }
  }
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '-')
}
