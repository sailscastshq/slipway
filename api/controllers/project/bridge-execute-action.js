module.exports = {
  friendlyName: 'Execute Bridge action',

  description:
    'Authorize and execute a configured Bridge resource, record, or bulk action.',

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
    actionName: {
      type: 'string',
      required: true
    },
    values: {
      type: 'ref',
      defaultsTo: {}
    },
    recordId: {
      type: 'ref'
    },
    recordIds: {
      type: 'ref'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    actionName,
    values,
    recordId,
    recordIds
  }) {
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveRequest.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        ...(appSlug ? { appSlug } : {}),
        requiredRole: 'editor',
        requireRunning: true
      })
    } catch (error) {
      if (error.code === 'forbidden') throw 'forbidden'
      if (error.code === 'notFound') throw { notFound: '/' }
      throw { badRequest: { error: 'App is not running' } }
    }
    const { project, environment, app, actor, auditUserId, bridgeBasePath } =
      resolved

    let loaded
    let allowedValues
    try {
      loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: actionName,
        actor,
        ...(recordId !== undefined ? { recordId } : {}),
        ...(recordIds !== undefined ? { recordIds } : {})
      })
      if (!loaded.actionDefinition) {
        const error = new Error(
          `${loaded.resource.singularLabel} does not define this custom action.`
        )
        error.code = 'BRIDGE_ACTION_NOT_FOUND'
        throw error
      }
      allowedValues = await sails.helpers.bridge.allowActionValues.with({
        values,
        resource: loaded.resource,
        action: loaded.actionDefinition
      })
    } catch (error) {
      throw { badRequest: toBadRequest(error) }
    }

    const action = loaded.actionDefinition
    const auditDetails = {
      projectId: project.id,
      projectSlug: project.slug,
      environmentId: environment.id,
      environmentSlug: environment.slug,
      appId: app.id,
      resource: loaded.resource.identity,
      action: action.name,
      scope: action.scope,
      ...(loaded.recordId !== undefined
        ? { recordId: String(loaded.recordId) }
        : {}),
      ...(loaded.recordIds !== undefined
        ? {
            recordCount: loaded.recordIds.length,
            recordIds: loaded.recordIds.map(String)
          }
        : {})
    }

    let outcome
    try {
      outcome = await sails.helpers.bridge.executeCustomAction.with({
        containerName: app.containerName,
        resource: loaded.resource,
        action,
        actor,
        values: allowedValues,
        ...(loaded.recordId !== undefined ? { recordId: loaded.recordId } : {}),
        ...(loaded.recordIds !== undefined
          ? { recordIds: loaded.recordIds }
          : {})
      })
    } catch (error) {
      await sails.helpers.audit.log.with({
        action: 'bridge.action.failed',
        resourceType: 'bridgeAction',
        resourceId: auditResourceId(loaded.resource, action, loaded),
        details: {
          ...auditDetails,
          error: safeAuditError(error.message)
        },
        ...(auditUserId ? { userId: auditUserId } : {}),
        teamId: auditTeamId(project),
        ipAddress: this.req.ip
      })
      throw { badRequest: { error: error.message } }
    }

    await sails.helpers.audit.log.with({
      action: 'bridge.action.succeeded',
      resourceType: 'bridgeAction',
      resourceId: auditResourceId(loaded.resource, action, loaded),
      details: auditDetails,
      ...(auditUserId ? { userId: auditUserId } : {}),
      teamId: auditTeamId(project),
      ipAddress: this.req.ip
    })

    sails.inertia.flash(
      'success',
      outcome.message || action.success || `${action.label} completed.`
    )
    return actionRedirect({
      bridgeBasePath,
      resource: loaded.resource,
      loaded
    })
  }
}

function actionRedirect({ bridgeBasePath, resource, loaded }) {
  const modelPath = `${bridgeBasePath}/${resource.identity}`
  if (loaded.actionDefinition.scope !== 'record') return modelPath
  return `${modelPath}/${encodeURIComponent(String(loaded.recordId))}`
}

function auditResourceId(resource, action, loaded) {
  if (loaded.recordId !== undefined) return String(loaded.recordId)
  return `${resource.identity}:${action.name}`.slice(0, 200)
}

function safeAuditError(message) {
  return String(message || 'Bridge action failed.')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

function auditTeamId(project) {
  return String(
    project.team && typeof project.team === 'object'
      ? project.team.id
      : project.team
  )
}

function toBadRequest(error) {
  if (!error?.fieldErrors) return { error: error.message }
  return {
    error: error.message,
    problems: Object.entries(error.fieldErrors).map(([field, message]) => ({
      [field]: message
    }))
  }
}
