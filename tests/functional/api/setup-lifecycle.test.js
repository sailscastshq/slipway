const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test('setup requires the server claim token and never exposes it in page props', async ({
  request,
  sails,
  expect
}) => {
  const guest = await withCsrfFromPage(request, '/setup')
  expect(
    JSON.stringify(guest.page.data).includes(sails.config.custom.setupToken)
  ).toBe(false)
  await guest.request.post('/setup', {
    email: 'uninvited@example.com',
    password: 'secret123!',
    confirmPassword: 'secret123!',
    setupToken: 'wrong'
  })
  expect(await sails.models.user.count()).toBe(0)
  expect(
    await sails.models.setting.count({ key: 'installationCompleted' })
  ).toBe(0)
})

test('concurrent setup requests commit exactly one founder and team', async ({
  request,
  sails,
  expect
}) => {
  const guest = await withCsrfFromPage(request, '/setup')
  const setupToken = sails.config.custom.setupToken
  await Promise.all(
    ['one', 'two'].map((name) =>
      guest.request.post('/setup', {
        email: `${name}@example.com`,
        password: 'secret123!',
        confirmPassword: 'secret123!',
        setupToken
      })
    )
  )
  expect(await sails.models.user.count({ isGenesisUser: true })).toBe(1)
  expect(await sails.models.team.count()).toBe(1)
  expect(
    await sails.models.setting.count({ key: 'installationCompleted' })
  ).toBe(1)
  // Even out-of-band removal plus loss of the in-memory flag cannot reopen setup.
  await sails.models.team.destroy({})
  await sails.models.user.destroy({})
  sails.config.custom.slipwayIsSetup = false
  expect(await request.get('/setup')).toHaveStatus(403)
})

test(
  'founder deletion returns a useful error and keeps the account',
  { world: 'configured-slipway' },
  async ({ request, sails, world, expect }) => {
    const browser = await withCsrfFromPage(request, '/profile', 'genesisUser')
    const response = await browser.request.delete('/profile', {
      password: world.current.auth.genesisUserPassword
    })
    expect(response).toHaveStatus(303)
    expect(
      await sails.models.user.count({ id: world.current.users.genesisUser.id })
    ).toBe(1)
    const page = await browser.request.get('/profile')
    expect(JSON.stringify(page.data)).toContain(
      'installation administrator cannot delete'
    )
  }
)
