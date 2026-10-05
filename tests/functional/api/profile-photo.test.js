const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
const photos = require('../../../api/lib/profile-photo')

test(
  'own photo action requires authentication and CSRF before receiving uploads',
  { world: 'configured-slipway' },
  async ({ request, world, sails, expect }) => {
    const originalStorage = sails.helpers.uploads.getStorageConfig
    const originalUpload = photos.upload
    let captured = null
    sails.helpers.uploads.getStorageConfig = {
      with: async () => ({
        publicUrl: 'https://files.example.test',
        bucket: 'fixture'
      })
    }
    photos.upload = async (input) => {
      captured = input.user.id
    }
    try {
      const guestSession = await withCsrfFromPage(request, '/login')
      const guest = await guestSession.request.post('/profile/photo', {
        photo: {},
        userId: 9999
      })
      expect(guest).toHaveStatus(302)
      expect(guest).toRedirectTo('/login')
      const withoutCsrf = await request
        .as('genesisUser')
        .post('/profile/photo', { photo: {}, userId: 9999 })
      expect(withoutCsrf).toHaveStatus(403)
      expect(captured).toBe(null)
    } finally {
      sails.helpers.uploads.getStorageConfig = originalStorage
      photos.upload = originalUpload
    }
  }
)
