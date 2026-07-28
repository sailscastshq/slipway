const crypto = require('node:crypto')
const path = require('node:path')

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
  friendlyName: 'Upload Bridge field',

  description:
    'Stream a configured Bridge file field to app-scoped object storage.',

  files: ['file'],

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
    values: {
      type: 'string',
      defaultsTo: '{}'
    },
    file: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      description: 'The configured Bridge field was uploaded.'
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
    values
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
    const fieldType = attribute?.field?.type
    if (
      !loaded.resource[surface]?.includes(fieldName) ||
      !(
        ['file', 'image', 'upload'].includes(fieldType) ||
        (fieldType === 'richtext' &&
          attribute.field.format?.toLowerCase() === 'markdown' &&
          attribute.field.upload?.kind === 'image')
      ) ||
      attribute.field.upload?.storage !== 'bridge'
    ) {
      throw {
        notFound: { message: 'This Bridge upload field is not available.' }
      }
    }

    let storage
    try {
      storage = await sails.helpers.bridge.getUploadStorageConfig.with({
        app,
        environment
      })
    } catch (error) {
      throw { badRequest: { message: error.message } }
    }

    const upload = attribute.field.upload
    let uploadValues
    let objectPathConfig
    try {
      uploadValues = parseUploadValues(values)
      await sails.helpers.bridge.authorizeRelationshipValues.with({
        containerName: app.containerName,
        environmentId: environment.id,
        resource: loaded.resource,
        actor,
        values: uploadValues
      })
      objectPathConfig =
        await sails.helpers.bridge.resolveUploadObjectPath.with({
          containerName: app.containerName,
          resource: loaded.resource,
          resources: loaded.contract?.models || {
            [loaded.resource.identity]: loaded.resource
          },
          upload,
          values: uploadValues,
          ...(recordId ? { recordId: loaded.recordId } : {})
        })
    } catch (error) {
      throw { badRequest: { message: error.message } }
    }

    const namespace =
      upload.scope === 'bucket'
        ? []
        : [
            'bridge',
            `teams/${safeSegment(project.team)}`,
            `projects/${safeSegment(project.id)}`,
            `environments/${safeSegment(environment.id)}`,
            safeSegment(modelIdentity),
            safeSegment(fieldName)
          ]
    const directory = [...namespace, objectPathConfig.directory]
      .filter(Boolean)
      .join('/')
    const objectId = crypto.randomUUID()

    const uploadedFiles = await new Promise((resolve, reject) => {
      this.req.file('file').upload(
        {
          adapter: require('skipper-s3'),
          key: storage.key,
          secret: storage.secret,
          bucket: storage.bucket,
          endpoint: storage.endpoint,
          region: storage.region || 'us-east-1',
          dirname: directory,
          maxBytes: upload.maxBytes,
          saveAs: (incoming, proceed) => {
            if (!acceptsMimeType(incoming.type, upload.accept)) {
              proceed(
                new Error(
                  `Choose a file matching: ${upload.accept.join(', ')}.`
                )
              )
              return
            }
            const extension =
              MIME_EXTENSIONS[incoming.type] ||
              safeExtension(incoming.filename || '')
            proceed(
              null,
              `${objectPathConfig.filename || objectId}${extension}`
            )
          }
        },
        (error, files) => {
          if (error) reject(error)
          else resolve(files)
        }
      )
    }).catch((error) => {
      throw {
        badRequest: {
          message:
            error.code === 'E_EXCEEDS_UPLOAD_LIMIT'
              ? `Files for ${attribute.label} must be ${formatBytes(
                  upload.maxBytes
                )} or smaller.`
              : error.message || 'The file could not be uploaded.'
        }
      }
    })

    if (!uploadedFiles?.length) {
      throw { badRequest: { message: 'Choose a file to upload.' } }
    }

    const fileName = String(uploadedFiles[0].fd).split('/').pop()
    const objectPath = [directory, fileName].filter(Boolean).join('/')
    const url = `${storage.publicUrl.replace(/\/$/, '')}/${objectPath}`
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
        name: uploadedFiles[0].filename,
        size: uploadedFiles[0].size,
        type: uploadedFiles[0].type
      }
    }
  }
}

function acceptsMimeType(type, accepted) {
  if (!Array.isArray(accepted) || accepted.length === 0) return true
  return accepted.some((candidate) => {
    if (candidate.endsWith('/*')) {
      return type.startsWith(candidate.slice(0, -1))
    }
    return type === candidate
  })
}

function safeExtension(filename) {
  const extension = path.extname(filename).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '-')
}

function parseUploadValues(value) {
  if (value === undefined || value === null || value === '') value = '{}'
  if (typeof value !== 'string' || value.length > 64 * 1024) {
    throw new Error('Bridge upload context is invalid.')
  }

  let parsed
  try {
    parsed = JSON.parse(value || '{}')
  } catch {
    throw new Error('Bridge upload context is invalid.')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(parsed))
  ) {
    throw new Error('Bridge upload context is invalid.')
  }
  return parsed
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}
