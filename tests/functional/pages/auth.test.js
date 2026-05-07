const { test } = require('sounding')

test('a guest is sent to login once Slipway is configured', async ({
  visit,
  expect,
  sails
}) => {
  await sails.sounding.world.use('configured-slipway')

  const response = await visit('/')

  expect(response).toHaveStatus(302)
  expect(response).toRedirectTo('/login')
})

test('genesis user can authenticate with the real password flow', async ({
  auth,
  expect,
  sails
}) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const guest = await sails.sounding.world.use('csrf-guest')
  const loginRequest = await guest.guest.requestFor('/login')

  const result = await auth.request.withPassword(current.users.genesisUser, {
    password: current.auth.genesisUserPassword,
    returnUrl: '/projects/new',
    request: loginRequest
  })

  expect(result.response).toHaveStatus(302)
  expect(result.response).toRedirectTo('/projects/new')
})

test('forgot password sends a reset email through the real mail helper', async ({
  expect,
  mailbox,
  sails
}) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const guest = await sails.sounding.world.use('csrf-guest')
  const request = await guest.guest.requestFor('/forgot-password')
  const previousMailConfig = sails.config.sounding.mail
  sails.config.sounding.mail = {
    ...(previousMailConfig || {}),
    deliver: true
  }

  try {
    const response = await request.post('/forgot-password', {
      email: current.users.genesisUser.email.toUpperCase()
    })

    expect(response).toHaveStatus(302)
    expect(response).toRedirectTo('/check-email')

    const updatedUser = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })
    const message = mailbox.latest()

    expect(updatedUser.passwordResetToken).toBeTruthy()
    expect(message.template).toBe('reset-password')
    expect(message.to).toContain(current.users.genesisUser.email)
    expect(message.html).toContain('/reset-password')
  } finally {
    sails.config.sounding.mail = previousMailConfig
  }
})

test('check email page exposes resend cooldown state', async ({
  expect,
  visit
}) => {
  const page = await visit('/check-email', {
    session: {
      emailLinkResendAvailableAt: Date.now() + 30 * 1000
    }
  })

  expect(page).toHaveStatus(200)
  expect(page).toBeInertiaPage('auth/check-email')
  expect(page.data.props.resendCooldownSecondsRemaining > 0).toBeTruthy()
  expect(page.data.props.resendCooldownDurationSeconds).toBe(30)
})

test('password reset success page uses Slipway copy', async ({
  expect,
  visit
}) => {
  const page = await visit('/reset-password/success')

  expect(page).toHaveStatus(200)
  expect(page).toBeInertiaPage('auth/success')
  expect(page.data.props.pageTitle).toBe('Password updated')
  expect(page.data.props.pageHeading).toBe('Password updated')
  expect(page.data.props.message).toBe(
    'Your new password is saved. You are signed in and ready to continue.'
  )
})

test('resend link after forgot password sends another reset email', async ({
  expect,
  mailbox,
  sails
}) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const previousMailConfig = sails.config.sounding.mail
  sails.config.sounding.mail = {
    ...(previousMailConfig || {}),
    deliver: true
  }

  try {
    const response = await sails.sounding.request
      .withSession({
        userEmail: current.users.genesisUser.email
      })
      .get('/resend-link')

    expect(response).toHaveStatus(302)
    expect(response).toRedirectTo('/check-email')

    const updatedUser = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })
    const message = mailbox.latest()

    expect(updatedUser.emailStatus).toBe('verified')
    expect(updatedUser.passwordResetToken).toBeTruthy()
    expect(message.template).toBe('reset-password')
    expect(message.to).toContain(current.users.genesisUser.email)
    expect(message.html).toContain('/reset-password')
  } finally {
    sails.config.sounding.mail = previousMailConfig
  }
})

test('resend link refuses requests during the cooldown window', async ({
  expect,
  mailbox,
  sails
}) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const previousMailConfig = sails.config.sounding.mail
  sails.config.sounding.mail = {
    ...(previousMailConfig || {}),
    deliver: true
  }

  try {
    const response = await sails.sounding.request
      .withSession({
        userEmail: current.users.genesisUser.email,
        emailLinkResendAvailableAt: Date.now() + 30 * 1000
      })
      .get('/resend-link')

    expect(response).toHaveStatus(302)
    expect(response).toRedirectTo('/check-email')
    expect(mailbox.all().length).toBe(0)
  } finally {
    sails.config.sounding.mail = previousMailConfig
  }
})

test('resend link for a pending email change sends verification to the candidate', async ({
  expect,
  mailbox,
  sails
}) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const nextEmail = 'next-email@example.com'
  const previousMailConfig = sails.config.sounding.mail
  sails.config.sounding.mail = {
    ...(previousMailConfig || {}),
    deliver: true
  }

  try {
    await sails.models.user
      .updateOne({ id: current.users.genesisUser.id })
      .set({
        emailStatus: 'change-requested',
        emailChangeCandidate: nextEmail,
        emailProofToken: 'old-token',
        emailProofTokenExpiresAt: Date.now() + 1000
      })

    const response = await sails.sounding.request
      .withSession({
        userId: current.users.genesisUser.id
      })
      .get('/resend-link')

    expect(response).toHaveStatus(302)
    expect(response).toRedirectTo('/check-email')

    const updatedUser = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })
    const message = mailbox.latest()

    expect(updatedUser.emailStatus).toBe('change-requested')
    expect(updatedUser.emailChangeCandidate).toBe(nextEmail)
    expect(updatedUser.emailProofToken).toBeTruthy()
    expect(updatedUser.emailProofToken === 'old-token').toBeFalsy()
    expect(message.template).toBe('verify-new-email')
    expect(message.to).toContain(nextEmail)
    expect(message.html).toContain('/verify-email')
  } finally {
    sails.config.sounding.mail = previousMailConfig
  }
})
