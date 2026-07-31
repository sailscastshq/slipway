const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

function precognitive(request, field) {
  return request.withHeaders({
    Precognition: 'true',
    'Precognition-Validate-Only': field
  })
}

test(
  'instance settings validate without writes and still save normally',
  { world: 'configured-slipway' },
  async ({ sails, request, expect }) => {
    const browser = await withCsrfFromPage(
      request,
      '/settings/instance',
      'genesisUser'
    )
    const originalDomain = await sails.helpers.setting.get('instanceDomain')
    const originalName = await sails.helpers.setting.get('instanceName')

    const invalid = await precognitive(browser.request, 'instanceDomain').patch(
      '/settings/instance',
      {
        instanceDomain: 'https://example.com/admin'
      }
    )

    expect(invalid).toHaveStatus(422)
    expect(Boolean(invalid.data.errors.instanceDomain)).toBe(true)
    expect(await sails.helpers.setting.get('instanceDomain')).toBe(
      originalDomain
    )

    const valid = await precognitive(browser.request, 'instanceName').patch(
      '/settings/instance',
      {
        instanceName: 'Slipway Harbor'
      }
    )

    expect(valid).toHaveStatus(204)
    expect(valid).toHaveHeader('precognition-success', 'true')
    expect(await sails.helpers.setting.get('instanceName')).toBe(originalName)

    const saved = await browser.request.patch('/settings/instance', {
      instanceName: 'Slipway Harbor'
    })

    expect(saved).toHaveStatus(409)
    expect(saved).toHaveHeader('x-inertia-location', '/settings/instance')
    expect(await sails.helpers.setting.get('instanceName')).toBe(
      'Slipway Harbor'
    )
  }
)

test(
  'integration settings reject unsafe values without leaking or persisting them',
  { world: 'configured-slipway' },
  async ({ sails, request, expect }) => {
    const secret = 'do-not-return-this-credential'
    await sails.helpers.setting.set('telegramBotToken', secret)
    await sails.helpers.setting.set(
      'discordWebhookUrl',
      `https://discord.example.com/${secret}`
    )
    const browser = await withCsrfFromPage(
      request,
      '/settings/notifications',
      'genesisUser'
    )
    expect(browser.page).toHaveInertiaProp('telegram.botToken', '')
    expect(browser.page).toHaveInertiaProp('telegram.hasBotToken', true)
    expect(browser.page).toHaveInertiaProp('discord.webhookUrl', '')
    expect(browser.page).toHaveInertiaProp('discord.hasWebhookUrl', true)
    expect(JSON.stringify(browser.page.data.props).includes(secret)).toBe(false)
    const originalWebhook = await sails.helpers.setting.get('webhookUrl')

    const invalid = await precognitive(browser.request, 'webhookUrl').patch(
      '/settings/notifications',
      {
        webhookEnabled: true,
        webhookUrl: `https://admin:${secret}@example.com/hook`
      }
    )

    expect(invalid).toHaveStatus(422)
    expect(Boolean(invalid.data.errors.webhookUrl)).toBe(true)
    expect(JSON.stringify(invalid.data).includes(secret)).toBe(false)
    expect(await sails.helpers.setting.get('webhookUrl')).toBe(originalWebhook)

    const valid = await precognitive(browser.request, 'webhookUrl').patch(
      '/settings/notifications',
      {
        webhookEnabled: true,
        webhookUrl: 'https://events.example.com/slipway'
      }
    )

    expect(valid).toHaveStatus(204)
    expect(valid).toHaveHeader('precognition-success', 'true')
    expect(await sails.helpers.setting.get('webhookUrl')).toBe(originalWebhook)

    const originalClientId = await sails.helpers.setting.get('githubClientId')
    const invalidGit = await precognitive(
      browser.request,
      'clientSecret'
    ).patch('/settings/git', {
      clientId: 'github-client-id',
      clientSecret: secret.repeat(200)
    })

    expect(invalidGit).toHaveStatus(422)
    expect(Boolean(invalidGit.data.errors.clientSecret)).toBe(true)
    expect(JSON.stringify(invalidGit.data).includes(secret)).toBe(false)
    expect(await sails.helpers.setting.get('githubClientId')).toBe(
      originalClientId
    )
  }
)

test(
  'global environment and upload validation cannot alter stored settings',
  { world: 'configured-slipway' },
  async ({ sails, request, expect }) => {
    const envBrowser = await withCsrfFromPage(
      request,
      '/settings/global-env',
      'genesisUser'
    )
    const originalEnv = await sails.helpers.setting.get('globalEnvVars')

    const duplicateEnv = await precognitive(
      envBrowser.request,
      'envVars'
    ).patch('/settings/global-env', {
      envVars: { API_KEY: 'second-secret' },
      envSource: 'API_KEY=first-secret\nAPI_KEY=second-secret'
    })

    expect(duplicateEnv).toHaveStatus(422)
    expect(Boolean(duplicateEnv.data.errors.envVars)).toBe(true)
    expect(JSON.stringify(duplicateEnv.data).includes('first-secret')).toBe(
      false
    )
    expect(await sails.helpers.setting.get('globalEnvVars')).toBe(originalEnv)

    const uploadsBrowser = await withCsrfFromPage(
      request,
      '/settings/uploads',
      'genesisUser'
    )
    const originalSchedule = await sails.helpers.setting.get('backupSchedule')
    const invalidStorage = await precognitive(
      uploadsBrowser.request,
      'endpoint'
    ).patch('/settings/uploads', {
      provider: 'r2',
      accessKey: 'test-access-key',
      secretKey: 'test-secret-key',
      bucket: 'slipway-backups',
      endpoint: 'https://operator:private@example.com'
    })

    expect(invalidStorage).toHaveStatus(422)
    expect(Boolean(invalidStorage.data.errors.endpoint)).toBe(true)
    expect(await sails.helpers.setting.get('globalEnvVars')).toBe(originalEnv)

    const invalidSchedule = await precognitive(
      uploadsBrowser.request,
      'backupSchedule.intervalHours'
    ).patch('/settings/uploads', {
      backupSchedule: {
        enabled: true,
        intervalHours: 0,
        retentionCount: 10
      }
    })

    expect(invalidSchedule).toHaveStatus(422)
    expect(
      Boolean(invalidSchedule.data.errors['backupSchedule.intervalHours'])
    ).toBe(true)
    expect(await sails.helpers.setting.get('backupSchedule')).toBe(
      originalSchedule
    )
  }
)

test(
  'notification tests keep using credentials hidden from page props',
  { world: 'configured-slipway' },
  async ({ sails, request, expect }) => {
    const originalFetch = global.fetch
    const storedWebhook = 'https://discord.example.com/stored-secret'
    const deliveries = []

    try {
      await sails.helpers.setting.set('discordWebhookUrl', storedWebhook)
      global.fetch = async (url) => {
        deliveries.push(url)
        return { ok: true, text: async () => '' }
      }
      const browser = await withCsrfFromPage(
        request,
        '/settings/notifications',
        'genesisUser'
      )

      expect(
        JSON.stringify(browser.page.data.props).includes(storedWebhook)
      ).toBe(false)

      const response = await browser.request.post(
        '/settings/notifications/test',
        {
          channel: 'discord',
          discordWebhookUrl: ''
        }
      )

      expect(response).toHaveStatus(302)
      expect(response).toRedirectTo('/settings/notifications')
      expect(deliveries).toEqual([storedWebhook])
    } finally {
      global.fetch = originalFetch
    }
  }
)

test(
  'team and token Precognition requests perform no side effects',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const team = current.teams.genesisTeam
    const user = current.users.genesisUser
    const browser = await withCsrfFromPage(
      request,
      '/settings/team-profile',
      'genesisUser'
    )
    const cliToken = await sails.models.clitoken
      .create({
        token: 'settings-validation-token-hash',
        user: user.id,
        name: 'Workstation'
      })
      .fetch()
    const member = await world.create('user').with({
      fullName: 'Settings Member',
      email: 'settings-member@example.com',
      team: team.id,
      teamRole: 'member'
    })
    const usersBefore = await sails.models.user.count()
    const deployTokensBefore = await sails.models.deploytoken.count()

    const invalidTeam = await precognitive(browser.request, 'name').patch(
      '/settings/team-profile',
      { name: '---' }
    )
    expect(invalidTeam).toHaveStatus(422)
    expect((await sails.models.team.findOne({ id: team.id })).name).toBe(
      team.name
    )

    const invite = await precognitive(browser.request, 'email').post(
      '/settings/team/invite',
      {
        email: 'future-teammate@example.com',
        role: 'member'
      }
    )
    expect(invite).toHaveStatus(204)
    expect(await sails.models.user.count()).toBe(usersBefore)

    const role = await precognitive(browser.request, 'role').patch(
      `/settings/team/${member.id}/role`,
      { role: 'admin' }
    )
    expect(role).toHaveStatus(204)
    expect((await sails.models.user.findOne({ id: member.id })).teamRole).toBe(
      'member'
    )

    const rename = await precognitive(browser.request, 'name').patch(
      `/settings/cli-tokens/${cliToken.id}`,
      { name: 'Production laptop' }
    )
    expect(rename).toHaveStatus(204)
    expect(
      (await sails.models.clitoken.findOne({ id: cliToken.id })).name
    ).toBe('Workstation')

    const deployToken = await precognitive(browser.request, 'name').post(
      '/api/v1/deploy-tokens',
      {
        name: 'Release workflow',
        scopes: ['deploy']
      }
    )
    expect(deployToken).toHaveStatus(204)
    expect(await sails.models.deploytoken.count()).toBe(deployTokensBefore)
  }
)
