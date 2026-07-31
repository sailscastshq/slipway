const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test('the genesis user gets the setup path before Slipway is configured', async ({
  visit,
  expect
}) => {
  const response = await visit('/')

  expect(response).toHaveStatus(302)
  expect(response).toRedirectTo('/setup')
})

test('setup validates with Precognition without creating anything', async ({
  expect,
  sails,
  request
}) => {
  const guest = await withCsrfFromPage(request, '/setup')
  const response = await guest.request
    .withHeaders({
      Precognition: 'true',
      'Precognition-Validate-Only': 'email'
    })
    .post('/setup', {
      email: 'founder@example.com',
      password: 'secret123!',
      confirmPassword: 'secret123!'
    })

  expect(response).toHaveStatus(204)
  expect(response).toHaveHeader('precognition', 'true')
  expect(response).toHaveHeader('precognition-success', 'true')
  expect(await sails.models.user.count()).toBe(0)
  expect(await sails.models.team.count()).toBe(0)
  expect(Boolean(sails.config.custom.slipwayIsSetup)).toBe(false)
})

test('setup returns a field error for invalid Precognition input', async ({
  expect,
  request
}) => {
  const guest = await withCsrfFromPage(request, '/setup')
  const response = await guest.request
    .withHeaders({
      Precognition: 'true',
      'Precognition-Validate-Only': 'email'
    })
    .post('/setup', {
      email: 'not-an-email',
      password: 'secret123!',
      confirmPassword: 'secret123!'
    })

  expect(response).toHaveStatus(422)
  expect(response.data.errors.email).toContain(
    'Please enter a valid email address'
  )
  expect(response.data.errors.password).toBe(undefined)
})

test('setup validates password confirmation before submit', async ({
  expect,
  request
}) => {
  const guest = await withCsrfFromPage(request, '/setup')
  const response = await guest.request
    .withHeaders({
      Precognition: 'true',
      'Precognition-Validate-Only': 'confirmPassword'
    })
    .post('/setup', {
      email: 'founder@example.com',
      password: 'secret123!',
      confirmPassword: 'different123!'
    })

  expect(response).toHaveStatus(422)
  expect(response.data.errors.confirmPassword).toContain(
    'Password confirmation does not match'
  )
})

test('setup creates the genesis owner and default team', async ({
  expect,
  sails,
  request
}) => {
  const guest = await withCsrfFromPage(request, '/setup')

  const response = await guest.request.post('/setup', {
    email: 'founder@example.com',
    password: 'secret123!',
    confirmPassword: 'secret123!'
  })

  expect(response).toHaveStatus(302)
  expect(response).toRedirectTo('/')
  expect(sails.config.custom.slipwayIsSetup).toBe(true)

  const founder = await sails.models.user.findOne({
    email: 'founder@example.com'
  })
  expect(Boolean(founder)).toBe(true)
  expect(founder.isGenesisUser).toBe(true)
  expect(founder.teamRole).toBe('owner')

  const team = await sails.models.team.findOne({ owner: founder.id })
  expect(Boolean(team)).toBe(true)
  expect(team.name).toBe("Founder's Team")
  expect(founder.team).toBe(team.id)
})

test(
  'setup path is blocked once the genesis owner exists',
  { world: 'configured-slipway' },
  async ({ get, expect }) => {
    const response = await get('/setup')

    expect(response).toHaveStatus(403)
  }
)
