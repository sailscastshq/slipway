const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'a guest is sent to login once Slipway is configured',
  { world: 'configured-slipway' },
  async ({ visit, expect }) => {
    const response = await visit('/')

    expect(response).toHaveStatus(302)
    expect(response).toRedirectTo('/login')
  }
)

test(
  'genesis user can authenticate with the real password flow',
  { world: 'configured-slipway' },
  async ({ auth, request, world, expect }) => {
    const guest = await withCsrfFromPage(request, '/login')
    const result = await auth.request.withPassword('genesisUser', {
      password: world.current.auth.genesisUserPassword,
      returnUrl: '/projects/new',
      request: guest.request
    })

    expect(result.response).toHaveStatus(302)
    expect(result.response).toRedirectTo('/projects/new')
  }
)

test(
  'login Precognition validates shape without revealing an account',
  { world: 'configured-slipway' },
  async ({ request, world, expect }) => {
    const guest = await withCsrfFromPage(request, '/login')
    const precognitive = guest.request.withHeaders({
      Precognition: 'true',
      'Precognition-Validate-Only': 'email'
    })

    const existingAccount = await precognitive.post('/login', {
      email: world.current.users.genesisUser.email,
      password: 'not-the-password'
    })
    const unknownAccount = await precognitive.post('/login', {
      email: 'nobody@example.com',
      password: 'not-the-password'
    })

    expect(existingAccount).toHaveStatus(204)
    expect(existingAccount).toHaveHeader('precognition-success', 'true')
    expect(unknownAccount).toHaveStatus(204)
    expect(unknownAccount).toHaveHeader('precognition-success', 'true')
  }
)

test(
  'forgot password sends a reset email through the real mail helper',
  { world: 'configured-slipway' },
  async ({ request, world, expect, mailbox, sails }) => {
    const current = world.current
    const guest = await withCsrfFromPage(request, '/forgot-password')
    const previousMailConfig = sails.config.sounding.mail
    sails.config.sounding.mail = {
      ...(previousMailConfig || {}),
      deliver: true
    }

    try {
      const response = await guest.request.post('/forgot-password', {
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
  }
)

test(
  'forgot-password Precognition sends no mail and creates no token',
  { world: 'configured-slipway' },
  async ({ request, world, expect, mailbox, sails }) => {
    const current = world.current
    const guest = await withCsrfFromPage(request, '/forgot-password')
    const before = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })
    const response = await guest.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'email'
      })
      .post('/forgot-password', {
        email: current.users.genesisUser.email
      })
    const after = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })

    expect(response).toHaveStatus(204)
    expect(response).toHaveHeader('precognition-success', 'true')
    expect(after.passwordResetToken).toBe(before.passwordResetToken)
    expect(mailbox.all().length).toBe(0)
  }
)

test(
  'reset-password Precognition does not inspect or consume the token',
  { world: 'configured-slipway' },
  async ({ request, world, expect, sails }) => {
    const current = world.current
    const guest = await withCsrfFromPage(request, '/forgot-password')
    const before = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })
    const response = await guest.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'password'
      })
      .post('/reset-password', {
        token: 'token-that-does-not-exist',
        password: 'new-secret123!',
        confirmPassword: 'new-secret123!'
      })
    const after = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })

    expect(response).toHaveStatus(204)
    expect(response).toHaveHeader('precognition-success', 'true')
    expect(after.password).toBe(before.password)
  }
)

test(
  'reset-password validates confirmation without inspecting the token',
  { world: 'configured-slipway' },
  async ({ request, expect }) => {
    const guest = await withCsrfFromPage(request, '/forgot-password')
    const response = await guest.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'confirmPassword'
      })
      .post('/reset-password', {
        token: 'token-that-does-not-exist',
        password: 'new-secret123!',
        confirmPassword: 'different123!'
      })

    expect(response).toHaveStatus(422)
    expect(response.data.errors.confirmPassword).toContain(
      'Password confirmation does not match'
    )
  }
)

test(
  'password reset still updates the password on a normal submit',
  { world: 'configured-slipway' },
  async ({ request, world, expect, sails }) => {
    const current = world.current
    const token = 'valid-password-reset-token'
    await sails.models.user
      .updateOne({ id: current.users.genesisUser.id })
      .set({
        passwordResetToken: token,
        passwordResetTokenExpiresAt: Date.now() + 60_000
      })

    const guest = await withCsrfFromPage(
      request,
      `/reset-password?token=${token}`
    )
    const response = await guest.request.post('/reset-password', {
      token,
      password: 'new-secret123!',
      confirmPassword: 'new-secret123!'
    })
    const updated = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })

    expect(response).toHaveStatus(302)
    expect(response).toRedirectTo('/reset-password/success')
    expect(updated.passwordResetToken).toBe('')
    expect(updated.passwordResetTokenExpiresAt).toBe(0)
  }
)

test(
  'profile Precognition validates without changing the account',
  { world: 'configured-slipway' },
  async ({ request, world, expect, mailbox, sails }) => {
    const current = world.current
    const browser = await withCsrfFromPage(request, '/profile', 'genesisUser')
    const response = await browser.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'email'
      })
      .patch('/profile', {
        fullName: current.users.genesisUser.fullName,
        email: 'next-address@example.com',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      })
    const unchanged = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })

    expect(response).toHaveStatus(204)
    expect(response).toHaveHeader('precognition-success', 'true')
    expect(unchanged.email).toBe(current.users.genesisUser.email)
    expect(unchanged.emailChangeCandidate || '').toBe('')
    expect(mailbox.all().length).toBe(0)
  }
)

test(
  'profile requires the current password before accepting a new one',
  { world: 'configured-slipway' },
  async ({ request, world, expect }) => {
    const current = world.current
    const browser = await withCsrfFromPage(request, '/profile', 'genesisUser')
    const response = await browser.request
      .withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'currentPassword'
      })
      .patch('/profile', {
        fullName: current.users.genesisUser.fullName,
        email: current.users.genesisUser.email,
        currentPassword: '',
        password: 'new-secret123!',
        confirmPassword: 'new-secret123!'
      })

    expect(response).toHaveStatus(422)
    expect(response.data.errors.currentPassword).toContain(
      'Current password is required'
    )
  }
)

test(
  'profile changes still persist on a normal submit',
  { world: 'configured-slipway' },
  async ({ request, world, expect, sails }) => {
    const current = world.current
    const browser = await withCsrfFromPage(request, '/profile', 'genesisUser')
    const response = await browser.request.patch('/profile', {
      fullName: 'Updated Slipway Owner',
      email: current.users.genesisUser.email,
      currentPassword: '',
      password: '',
      confirmPassword: ''
    })
    const updated = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })

    expect(response).toHaveStatus(409)
    expect(response).toHaveHeader('x-inertia-location', 'back')
    expect(updated.fullName).toBe('Updated Slipway Owner')
  }
)

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
  expect(page).toHaveInertiaProp('resendCooldownSecondsRemaining')
  expect(page).toHaveInertiaProp('resendCooldownDurationSeconds', 30)
})

test('password reset success page uses Slipway copy', async ({
  expect,
  visit
}) => {
  const page = await visit('/reset-password/success')

  expect(page).toHaveStatus(200)
  expect(page).toBeInertiaPage('auth/success')
  expect(page).toHaveInertiaProps({
    pageTitle: 'Password updated',
    pageHeading: 'Password updated',
    message:
      'Your new password is saved. You are signed in and ready to continue.'
  })
})

test(
  'resend link after forgot password sends another reset email',
  { world: 'configured-slipway' },
  async ({ request, world, expect, mailbox, sails }) => {
    const current = world.current
    const previousMailConfig = sails.config.sounding.mail
    sails.config.sounding.mail = {
      ...(previousMailConfig || {}),
      deliver: true
    }

    try {
      const response = await request
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
  }
)

test(
  'resend link refuses requests during the cooldown window',
  { world: 'configured-slipway' },
  async ({ request, world, expect, mailbox, sails }) => {
    const current = world.current
    const previousMailConfig = sails.config.sounding.mail
    sails.config.sounding.mail = {
      ...(previousMailConfig || {}),
      deliver: true
    }

    try {
      const response = await request
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
  }
)

test(
  'resend link for a pending email change sends verification to the candidate',
  { world: 'configured-slipway' },
  async ({ request, world, expect, mailbox, sails }) => {
    const current = world.current
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

      const response = await request.as('genesisUser').get('/resend-link')

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
  }
)
