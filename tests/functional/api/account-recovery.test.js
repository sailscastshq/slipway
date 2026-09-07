const crypto = require('node:crypto')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'password reset consumes its link once and revokes old browser and CLI access',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const user = world.current.users.genesisUser
    const raw = crypto.randomBytes(32).toString('hex')
    await sails.models.clitoken.create({
      user: user.id,
      token: crypto.createHash('sha256').update(raw).digest('hex')
    })
    const token = 'reset-once-' + crypto.randomUUID()
    await sails.models.user.updateOne({ id: user.id }).set({
      passwordResetToken: token,
      passwordResetTokenExpiresAt: Date.now() + 60000,
      emailChangeCandidate: 'stale@example.com',
      emailProofToken: 'stale-proof',
      emailStatus: 'change-requested'
    })
    const guest = await withCsrfFromPage(request, '/login')
    const result = await guest.request.post('/reset-password', {
      token,
      password: 'New-password123!',
      confirmPassword: 'New-password123!'
    })
    expect(result).toHaveStatus(302)
    const updated = await sails.models.user.findOne({ id: user.id })
    expect(updated.authVersion.length > 0).toBe(true)
    expect(updated.passwordResetToken).toBe('')
    expect(updated.emailProofToken).toBe('')
    expect(updated.emailChangeCandidate).toBe('')
    expect(await sails.models.clitoken.count({ user: user.id })).toBe(0)
    expect(
      await request
        .withSession({ userId: user.id, authVersion: '' })
        .get('/api/v1/projects')
    ).toHaveStatus(401)
    expect(
      await request
        .withHeaders({ authorization: `Bearer sl_${raw}` })
        .get('/api/v1/projects')
    ).toHaveStatus(401)

    const anotherGuest = await withCsrfFromPage(
      request.withSession({ userId: null, authVersion: '' }),
      '/login'
    )
    const reused = await anotherGuest.request.post('/reset-password', {
      token,
      password: 'Other-password123!',
      confirmPassword: 'Other-password123!'
    })
    expect(reused).toHaveHeader('x-exit', 'invalidOrExpiredToken')
    expect((await sails.models.user.findOne({ id: user.id })).authVersion).toBe(
      updated.authVersion
    )
    expect(
      (await sails.models.user.findOne({ id: user.id })).emailChangeCandidate
    ).toBe('')
  }
)

test(
  'email changes require the current password and preserve the account on rejection',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const user = world.current.users.genesisUser
    const browser = await withCsrfFromPage(request, '/profile', 'genesisUser')
    const result = await browser.request.patch('/profile', {
      fullName: user.fullName,
      email: 'unverified-change@example.com'
    })
    expect(result).toHaveStatus(303)
    expect(result).toHaveHeader('x-exit', 'invalid')
    expect(
      (await sails.models.user.findOne({ id: user.id })).emailChangeCandidate
    ).toBe('')
  }
)

test(
  'a password change invalidates old browser versions and preserves current authentication',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const user = world.current.users.genesisUser
    const browser = await withCsrfFromPage(request, '/profile', 'genesisUser')
    const result = await browser.request.patch('/profile', {
      fullName: user.fullName,
      email: user.email,
      currentPassword: world.current.auth.genesisUserPassword,
      password: 'Changed-password123!',
      confirmPassword: 'Changed-password123!'
    })
    expect(result).toHaveStatus(409)
    const updated = await sails.models.user.findOne({ id: user.id })
    expect(updated.authVersion.length > 0).toBe(true)
    expect(
      await request
        .withSession({ userId: user.id, authVersion: '' })
        .get('/api/v1/projects')
    ).toHaveStatus(401)
    expect(
      await request
        .withSession({ userId: user.id, authVersion: updated.authVersion })
        .get('/api/v1/projects')
    ).toHaveStatus(200)
  }
)

test(
  'two password reset submissions cannot both consume the same token',
  { world: 'configured-slipway' },
  async ({ sails, world, expect }) => {
    const token = crypto.randomUUID()
    await sails.models.user
      .updateOne({ id: world.current.users.genesisUser.id })
      .set({
        passwordResetToken: token,
        passwordResetTokenExpiresAt: Date.now() + 60000
      })
    const action = require('../../../api/controllers/auth/reset-password')
    const submit = (password) =>
      action.fn.call(
        { req: { session: {}, headers: {} } },
        {
          token,
          password,
          confirmPassword: password
        }
      )
    const results = await Promise.allSettled([
      submit('First-password123!'),
      submit('Second-password123!')
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled').length
    ).toBe(1)
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' &&
          result.reason === 'invalidOrExpiredToken'
      ).length
    ).toBe(1)
  }
)
