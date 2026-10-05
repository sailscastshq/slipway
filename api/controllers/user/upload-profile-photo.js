const photos = require('../../lib/profile-photo')
module.exports = {
  friendlyName: 'Upload own profile photo',
  files: ['photo'],
  inputs: { photo: { type: 'ref', required: true } },
  exits: {
    success: { responseType: 'inertiaRedirect' },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function () {
    const user = await User.forRequest(this.req)
    try {
      const storage = await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
      await photos.upload({ user, upstream: this.req.file('photo'), storage })
    } catch (error) {
      const message =
        error.code === 'E_EXCEEDS_UPLOAD_LIMIT'
          ? 'Photo must be smaller than 5 MB.'
          : /^(Choose |Photo must |The photo |The configured public photo URL)/.test(
              error.message || ''
            )
          ? error.message
          : 'The photo could not be saved. Please try again.'
      throw { badRequest: { problems: [{ photo: message }] } }
    }
    sails.inertia.refreshOnce('loggedInUser')
    return '/profile'
  }
}
