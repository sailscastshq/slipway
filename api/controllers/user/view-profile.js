module.exports = {
  friendlyName: 'View profile',

  description: 'Display "Profile" page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    let uploadsConfigured = true
    try {
      await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
    } catch {
      uploadsConfigured = false
    }
    return { page: 'dashboard/profile', props: { uploadsConfigured } }
  }
}
