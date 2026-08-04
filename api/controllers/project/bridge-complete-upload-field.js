module.exports = {
  friendlyName: 'Complete Bridge direct upload',

  description:
    'Verify a directly uploaded object before issuing a Bridge field receipt.',

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
    url: {
      type: 'string',
      required: true,
      maxLength: 2048
    },
    uploadReceipt: {
      type: 'string',
      required: true,
      maxLength: 4096
    }
  },

  exits: {
    success: {
      description: 'The directly uploaded object was verified.'
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
    url,
    uploadReceipt
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
      if (error.code === 'forbidden') {
        throw {
          forbidden: { message: 'Your Bridge role cannot upload files.' }
        }
      }
      if (error.code === 'notFound') throw 'notFound'
      throw { badRequest: { message: 'The target app is not running.' } }
    }

    const { project, environment, app, actor, actorId } = resolved
    try {
      await sails.helpers.bridge.verifyUploadReceipt.with({
        receipt: uploadReceipt,
        url,
        context: {
          actorId,
          projectId: project.id,
          environmentId: environment.id,
          resource: modelIdentity,
          field: fieldName
        }
      })
    } catch (error) {
      throw { badRequest: { message: error.message } }
    }

    let loaded
    try {
      loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: recordId ? 'update' : 'create',
        actor,
        ...(recordId ? { recordId } : {})
      })
    } catch (error) {
      throw { forbidden: { message: error.message } }
    }

    const surface = recordId ? 'edit' : 'create'
    const attribute = loaded.resource.attributes?.[fieldName]
    if (
      !loaded.resource[surface]?.includes(fieldName) ||
      attribute?.field?.upload?.storage !== 'bridge'
    ) {
      throw {
        notFound: { message: 'This Bridge upload field is not available.' }
      }
    }

    let storage
    let objectPath
    let verified
    try {
      storage = await sails.helpers.bridge.getUploadStorageConfig.with({
        app,
        environment
      })
      objectPath = objectPathFromPublicUrl(url, storage.publicUrl)
      verified = await sails.helpers.bridge.verifyDirectUploadObject.with({
        storage,
        objectPath
      })
    } catch (error) {
      throw { badRequest: { message: error.message } }
    }

    const upload = attribute.field.upload
    if (
      verified.size > upload.maxBytes ||
      !acceptsMimeType(verified.type, upload.accept)
    ) {
      throw {
        badRequest: {
          message: 'The uploaded object does not match this Bridge field.'
        }
      }
    }

    const receipt = await sails.helpers.bridge.createUploadReceipt.with({
      url,
      context: {
        actorId,
        projectId: project.id,
        environmentId: environment.id,
        resource: loaded.resource.identity,
        field: fieldName
      }
    })

    return {
      url,
      receipt,
      file: {
        name: objectPath.split('/').pop(),
        size: verified.size,
        type: verified.type,
        etag: verified.etag
      }
    }
  }
}

function objectPathFromPublicUrl(value, publicUrl) {
  let uploaded
  let base
  try {
    uploaded = new URL(value)
    base = new URL(`${publicUrl.replace(/\/$/, '')}/`)
  } catch {
    throw new Error('The upload destination is invalid.')
  }

  if (
    uploaded.origin !== base.origin ||
    uploaded.search ||
    uploaded.hash ||
    !uploaded.pathname.startsWith(base.pathname)
  ) {
    throw new Error('The upload destination no longer matches this app.')
  }
  const objectPath = decodeURIComponent(
    uploaded.pathname.slice(base.pathname.length)
  )
  if (!objectPath || objectPath.startsWith('/') || objectPath.includes('..')) {
    throw new Error('The upload destination is invalid.')
  }
  return objectPath
}

function acceptsMimeType(type, accepted) {
  if (!Array.isArray(accepted) || accepted.length === 0) return true
  return accepted.some((candidate) =>
    candidate.endsWith('/*')
      ? type.startsWith(candidate.slice(0, -1))
      : type === candidate
  )
}
