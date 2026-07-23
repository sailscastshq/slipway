const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'switching teams is an Inertia action that refreshes the active team',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const destination = await world.create('team').with({
      name: 'Operations',
      slug: 'operations',
      owner: current.users.genesisUser.id
    })
    const browser = await withCsrfFromPage(
      request,
      '/settings/team-profile',
      'genesisUser'
    )

    const response = await browser.request.post('/switch-team', {
      teamId: destination.id
    })

    expect(response).toHaveStatus(409)
    expect(response).toHaveHeader('x-inertia-location', '/')

    const user = await sails.models.user.findOne({
      id: current.users.genesisUser.id
    })
    expect(user.team).toBe(destination.id)

    const destinationPage = await browser.request.get('/')
    expect(destinationPage).toHaveInertiaProp(
      'flash.success',
      'Switched to Operations.'
    )
  }
)

test(
  'deleting a team logo redirects through Inertia and persists the change',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const team = world.current.teams.genesisTeam
    await sails.models.team.updateOne({ id: team.id }).set({
      logoUrl: 'https://assets.example.com/team.png'
    })
    const browser = await withCsrfFromPage(
      request,
      '/settings/team-profile',
      'genesisUser'
    )

    const response = await browser.request.delete(
      '/settings/team-profile/logo',
      {}
    )

    expect(response).toHaveStatus(409)
    expect(response).toHaveHeader(
      'x-inertia-location',
      '/settings/team-profile'
    )

    const updatedTeam = await sails.models.team.findOne({ id: team.id })
    expect(updatedTeam.logoUrl).toBe('')

    const page = await browser.request.get('/settings/team-profile')
    expect(page).toHaveInertiaProp('flash.success', 'Team logo removed.')
  }
)

test(
  'notification tests redirect with flash instead of returning JSON',
  { world: 'configured-slipway' },
  async ({ request, expect }) => {
    const originalFetch = global.fetch
    const deliveries = []

    try {
      global.fetch = async (url, options) => {
        deliveries.push({ url, options })
        return {
          ok: true,
          text: async () => ''
        }
      }
      const browser = await withCsrfFromPage(
        request,
        '/settings/notifications',
        'genesisUser'
      )

      const response = await browser.request.post(
        '/settings/notifications/test',
        {
          channel: 'discord',
          discordWebhookUrl: 'https://discord.example.com/test'
        }
      )

      expect(response).toHaveStatus(302)
      expect(response).toRedirectTo('/settings/notifications')
      expect(deliveries.length).toBe(1)
      expect(deliveries[0].url).toBe('https://discord.example.com/test')

      const page = await browser.request.get('/settings/notifications')
      expect(page).toHaveInertiaProp(
        'flash.success',
        'Test message sent to Discord.'
      )
    } finally {
      global.fetch = originalFetch
    }
  }
)

test(
  'notification delivery failures return Inertia form errors',
  { world: 'configured-slipway' },
  async ({ request, expect }) => {
    const originalFetch = global.fetch

    try {
      global.fetch = async () => ({
        ok: false,
        text: async () => 'Webhook rejected'
      })
      const browser = await withCsrfFromPage(
        request,
        '/settings/notifications',
        'genesisUser'
      )

      const response = await browser.request.post(
        '/settings/notifications/test',
        {
          channel: 'discord',
          discordWebhookUrl: 'https://discord.example.com/rejected'
        }
      )

      expect(response).toHaveStatus(303)

      const page = await browser.request.get('/settings/notifications')
      expect(page).toBeInertiaPage('settings/notifications')
      expect(page).toHaveInertiaError('discord', 'Webhook rejected')
    } finally {
      global.fetch = originalFetch
    }
  }
)

test(
  'starting a backup restore is an Inertia action while the API remains separate',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const project = await world.create('project').with({
      name: 'Archive',
      slug: 'archive',
      team: current.teams.genesisTeam.id,
      createdBy: current.users.genesisUser.id
    })
    const environment = await world.create('environment').with({
      project: project.id,
      name: 'Staging',
      slug: 'staging'
    })
    const service = await world.create('service').with({
      environment: environment.id,
      status: 'running'
    })
    const backup = await world.create('backup').with({
      service: service.id,
      status: 'completed',
      triggeredBy: current.users.genesisUser.id
    })
    const originalRestore = sails.helpers.backup.restoreBackup
    const restores = []

    try {
      sails.helpers.backup.restoreBackup = (backupId) => {
        restores.push(backupId)
        return Promise.resolve()
      }
      const browser = await withCsrfFromPage(
        request,
        '/settings/team-profile',
        'genesisUser'
      )

      const response = await browser.request.post(
        `/backups/${backup.id}/restore`,
        {}
      )

      expect(response).toHaveStatus(409)
      expect(response).toHaveHeader(
        'x-inertia-location',
        `/projects/archive/environments/staging/services/${service.id}`
      )
      expect(restores).toEqual([backup.id])
    } finally {
      sails.helpers.backup.restoreBackup = originalRestore
    }
  }
)
