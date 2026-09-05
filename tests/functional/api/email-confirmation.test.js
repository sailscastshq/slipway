const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'email change completes from the profile request and consumes its link once',
  { world: 'configured-slipway' },
  async ({ request, sails, world, expect }) => {
    const owner = world.current.users.genesisUser
    const browser = await withCsrfFromPage(request, '/profile', 'genesisUser')
    await browser.request.patch('/profile', {
      fullName: owner.fullName,
      email: 'New-Email@example.com',
      currentPassword: world.current.auth.genesisUserPassword
    })
    const pending = await sails.models.user.findOne({ id: owner.id })
    expect(pending.emailStatus).toBe('change-requested')
    expect(pending.emailProofToken.length > 0).toBe(true)
    const url = `/verify-email?token=${encodeURIComponent(
      pending.emailProofToken
    )}`
    expect(await request.get(url)).toHaveStatus(302)
    const updated = await sails.models.user.findOne({ id: owner.id })
    expect(updated.emailStatus).toBe('verified')
    expect(updated.email).toBe('new-email@example.com')
    expect(updated.emailProofToken).toBe('')
    expect(updated.authVersion === pending.authVersion).toBe(false)
    expect(await request.get(url)).toHaveHeader(
      'x-exit',
      'invalidOrExpiredToken'
    )
  }
)

test(
  'email confirmation preserves the old address when the candidate is taken',
  { world: 'configured-slipway' },
  async ({ request, sails, world, expect }) => {
    const owner = world.current.users.genesisUser
    await sails.models.user.create({
      email: 'taken@example.com',
      fullName: 'Other User',
      password: 'secret123!'
    })
    await sails.models.user
      .updateOne({ id: owner.id })
      .set({
        emailStatus: 'change-requested',
        emailChangeCandidate: 'taken@example.com',
        emailProofToken: 'taken-proof',
        emailProofTokenExpiresAt: Date.now() + 60000
      })
    const response = await request.get('/verify-email?token=taken-proof')
    expect(response).toHaveStatus(409)
    expect(response.data.message).toContain('no longer available')
    expect((await sails.models.user.findOne({ id: owner.id })).email).toBe(
      owner.email
    )
  }
)
