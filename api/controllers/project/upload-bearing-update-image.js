module.exports = {
  friendlyName: 'Upload Bearing update image',

  description:
    'Upload an image for a Bearing update into Slipway-owned object storage.',

  files: ['image'],

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    image: { type: 'ref', required: true }
  },

  exits: {
    success: { description: 'The image was uploaded.' },
    badRequest: { statusCode: 400 },
    forbidden: { statusCode: 403 },
    notFound: { statusCode: 404 }
  },

  fn: async function ({ slug, envSlug, appSlug, image }) {
    let resolved
    try {
      resolved = await sails.helpers.bearing.resolveManager.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        appSlug
      })
    } catch (error) {
      if (error.code === 'forbidden') {
        throw {
          forbidden: { message: 'Only a Bearing administrator can do that.' }
        }
      }
      throw { notFound: { message: 'Bearing was not found.' } }
    }

    const space = await BearingSpace.findOne({ app: resolved.app.id })
    if (!space) {
      throw { notFound: { message: 'Bearing is not enabled for this app.' } }
    }

    let storage
    try {
      storage = await sails.helpers.uploads.getStorageConfig()
    } catch {
      throw {
        badRequest: {
          message:
            'Image uploads are not configured. Add a public upload provider in Settings.'
        }
      }
    }

    let images
    try {
      images = await sails.helpers.bearing.uploadFeedbackImages.with({
        upstream: image,
        storage,
        directory: [
          'bearing',
          'teams',
          resolved.user.team,
          'projects',
          resolved.project.id,
          'apps',
          resolved.app.id,
          'updates',
          'assets'
        ].join('/')
      })
    } catch (error) {
      throw {
        badRequest: {
          message: error.message || 'The image could not be uploaded.'
        }
      }
    }

    if (!images.length) {
      throw { badRequest: { message: 'Choose an image to upload.' } }
    }

    return { imageUrl: images[0].url }
  }
}
