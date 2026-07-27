const crypto = require('node:crypto')
const path = require('node:path')

const IMAGE_EXTENSIONS = {
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
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

  fn: async function ({ slug, envSlug, modelIdentity, fieldName, recordId }) {
    const user = await User.findOne({
      id: this.req.session.userId
    }).populate('team')
    if (!user) {
      throw { forbidden: { message: 'Sign in before uploading a file.' } }
    }

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) {
      throw { notFound: { message: 'Project not found.' } }
    }
    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })
    if (!environment) {
      throw { notFound: { message: 'Environment not found.' } }
    }
    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))
    if (!app || app.status !== 'running') {
      throw { badRequest: { message: 'The target app is not running.' } }
    }

    let loaded
    try {
      const actor = await sails.helpers.bridge.buildActor.with({
        user,
        project,
        environment
      })
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
      !['file', 'image', 'upload'].includes(fieldType) ||
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
    const directory = [
      'bridge',
      `teams/${safeSegment(user.team.id)}`,
      `projects/${safeSegment(project.id)}`,
      `environments/${safeSegment(environment.id)}`,
      safeSegment(modelIdentity),
      safeSegment(fieldName),
      upload.directory
    ]
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
              IMAGE_EXTENSIONS[incoming.type] ||
              safeExtension(incoming.filename || '')
            proceed(null, `${objectId}${extension}`)
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
    const objectPath = `${directory}/${fileName}`
    const url = `${storage.publicUrl.replace(/\/$/, '')}/${objectPath}`
    const receipt = await sails.helpers.bridge.createUploadReceipt.with({
      url,
      context: {
        actorId: user.id,
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

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}
