const crypto = require('crypto')

const IMAGE_EXTENSIONS = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

module.exports = {
  friendlyName: 'Upload content image',

  description:
    'Upload an image for a Markdown document to the configured public object storage.',

  files: ['image'],

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    collection: {
      type: 'string',
      required: true,
      regex: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
    },
    file: {
      type: 'string',
      required: true,
      regex: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
    },
    image: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      description: 'The image was uploaded.'
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

  fn: async function ({ slug, envSlug }) {
    const user = await User.findOne({
      id: this.req.session.userId
    }).populate('team')
    if (!user) {
      throw { forbidden: { message: 'Sign in before uploading an image.' } }
    }

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) {
      throw { notFound: { message: 'Project not found.' } }
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })
    if (!environment?.features?.['sails-content']) {
      throw {
        notFound: { message: 'Content Manager is not available here.' }
      }
    }

    let storage
    try {
      storage = await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
    } catch (error) {
      throw {
        badRequest: {
          message: error.message
        }
      }
    }

    const dirname = `teams/${user.team.id}/projects/${project.id}/content`
    const imageId = crypto.randomUUID()
    const uploadedFiles = await new Promise((resolve, reject) => {
      this.req.file('image').upload(
        {
          adapter: require('skipper-s3'),
          key: storage.key,
          secret: storage.secret,
          bucket: storage.bucket,
          endpoint: storage.endpoint,
          region: storage.region || 'auto',
          dirname,
          maxBytes: 5 * 1024 * 1024,
          saveAs: (incoming, proceed) => {
            const extension = IMAGE_EXTENSIONS[incoming.type]
            if (!extension) {
              proceed(
                new Error('Choose an AVIF, GIF, JPEG, PNG, or WebP image.')
              )
              return
            }
            proceed(null, `${imageId}.${extension}`)
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
              ? 'Images must be 5 MB or smaller.'
              : error.message || 'The image could not be uploaded.'
        }
      }
    })

    if (!uploadedFiles?.length) {
      throw {
        badRequest: { message: 'Choose an image to upload.' }
      }
    }

    const fileName = uploadedFiles[0].fd.split('/').pop()
    const publicBase = getPublicUploadBase(storage)
    const imageUrl = `${publicBase}/${dirname}/${fileName}`

    return { imageUrl }
  }
}

function getPublicUploadBase(storage) {
  return storage.publicUrl.replace(/\/$/, '')
}
