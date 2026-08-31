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
    badGateway: { statusCode: 502 },
    forbidden: { statusCode: 403 },
    notFound: { statusCode: 404 },
    unavailable: { statusCode: 503 }
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
      storage = await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
    } catch (error) {
      throw {
        unavailable: {
          code: error.code || 'PUBLIC_UPLOAD_STORAGE_NOT_CONFIGURED',
          message: error.message,
          settingsUrl: '/settings/uploads'
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
      const failure = presentUploadFailure(error)
      if (failure.kind === 'request') {
        throw { badRequest: failure.body }
      }
      sails.log.warn(`Bearing update image upload failed: ${failure.log}`)
      throw { badGateway: failure.body }
    }

    if (!images.length) {
      throw { badRequest: { message: 'Choose an image to upload.' } }
    }

    return { imageUrl: images[0].url }
  }
}

function presentUploadFailure(error) {
  const code = String(error?.code || '')
  if (code.startsWith('BEARING_UPLOAD_')) {
    return {
      kind: 'request',
      body: {
        code,
        message: error.message || 'The image could not be uploaded.'
      },
      log: `${code}: ${error.message || 'invalid upload'}`
    }
  }

  const providerMessages = {
    AccessDenied:
      'Object storage denied the upload. Check that the access token can write objects to this bucket.',
    CredentialsError:
      'Object storage credentials could not be used. Check the access key and secret key in Settings → File storage.',
    InvalidAccessKeyId:
      'Object storage rejected the access key. Check Settings → File storage.',
    NetworkingError:
      'Slipway could not reach object storage. Check the endpoint in Settings → File storage and try again.',
    NoSuchBucket:
      'The configured object-storage bucket does not exist. Check Settings → File storage.',
    SignatureDoesNotMatch:
      'Object storage rejected the credentials. Check the secret key and endpoint in Settings → File storage.',
    UnknownEndpoint:
      'Slipway could not reach object storage. Check the endpoint in Settings → File storage and try again.'
  }

  return {
    kind: 'provider',
    body: {
      code: 'UPLOAD_STORAGE_PROVIDER_FAILED',
      message:
        providerMessages[code] ||
        'Object storage could not accept the image. Check Settings → File storage and try again.',
      settingsUrl: '/settings/uploads'
    },
    log: `${code || error?.name || 'Error'}: ${
      error?.message || 'unknown provider error'
    }`
  }
}

module.exports._private = { presentUploadFailure }
