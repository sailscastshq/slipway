const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
test(
  'private backup configuration is restricted to the instance administrator and returns no saved secrets',
  { world: { name: 'configured-slipway' } },
  async ({ sails, world, request, expect }) => {
    await sails.helpers.setting.set(
      'backupStorageConfig',
      JSON.stringify({
        provider: 'azure',
        account: 'storageaccount',
        bucket: 'private-backups',
        accountKey: 'never-return-this-key'
      })
    )
    const owner = await withCsrfFromPage(request, '/', 'genesisUser')
    const page = await owner.request.get('/settings/uploads', {
      headers: { 'X-Inertia': 'true' }
    })
    expect(page).toHaveStatus(200)
    expect(page.data.props.backupStorage.hasCredentials).toBe(true)
    expect(JSON.stringify(page.data).includes('never-return-this-key')).toBe(
      false
    )
    const invalid = await owner.request.post('/settings/backup-storage', {
      configuration: {
        provider: 'azure',
        bucket: 'private-backups',
        account: 'bad',
        sasToken: 'invalid'
      },
      testOnly: true
    })
    expect(invalid).toHaveStatus(400)
    const before = await sails.helpers.backup.getStorageConfig()
    expect(before.accountKey).toBe('never-return-this-key')
    const user = world.current.users.genesisUser
    await sails.models.user
      .updateOne({ id: user.id })
      .set({ isGenesisUser: false })
    const denied = await owner.request.post('/settings/backup-storage', {
      configuration: { provider: 'shared' }
    })
    expect(denied).toHaveStatus(403)
  }
)
