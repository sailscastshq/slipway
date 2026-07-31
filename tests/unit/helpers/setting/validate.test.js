const { test } = require('sounding')

test('settings validation accepts production-safe values', async ({
  sails,
  expect
}) => {
  const problems = sails.helpers.setting.validate(
    {
      instanceName: 'Slipway EU',
      instanceDomain: 'slipway.example.com',
      acmeEmail: 'ops@example.com',
      provider: 'r2',
      accessKey: 'safe-access-key',
      secretKey: 'safe-secret-key',
      bucket: 'slipway-backups',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      publicUrl: 'https://assets.example.com',
      backupSchedule: {
        enabled: true,
        intervalHours: 24,
        retentionCount: 20
      }
    },
    ['provider', 'accessKey', 'secretKey', 'bucket', 'endpoint']
  )

  expect(problems).toEqual([])
})

test('settings validation rejects unsafe integration values without echoing secrets', async ({
  sails,
  expect
}) => {
  const secret = 'do-not-echo-this-secret'
  const problems = sails.helpers.setting.validate({
    instanceDomain: 'example.com/admin',
    acmeEmail: 'not-an-email',
    telegramEnabled: true,
    telegramBotToken: secret,
    telegramChatId: 'not-a-chat',
    discordEnabled: true,
    discordWebhookUrl: 'http://discord.example.com/hook',
    smtpEnabled: true,
    smtpHost: 'https://smtp.example.com',
    smtpPort: '70000',
    smtpFrom: 'not-an-email',
    notificationEmails: 'ops@example.com, invalid'
  })
  const errors = Object.assign({}, ...problems)

  expect(Boolean(errors.instanceDomain)).toBe(true)
  expect(Boolean(errors.acmeEmail)).toBe(true)
  expect(Boolean(errors.telegramBotToken)).toBe(true)
  expect(Boolean(errors.telegramChatId)).toBe(true)
  expect(Boolean(errors.discordWebhookUrl)).toBe(true)
  expect(Boolean(errors.smtpHost)).toBe(true)
  expect(Boolean(errors.smtpPort)).toBe(true)
  expect(Boolean(errors.smtpFrom)).toBe(true)
  expect(Boolean(errors.notificationEmails)).toBe(true)
  expect(JSON.stringify(problems).includes(secret)).toBe(false)
})

test('settings validation rejects invalid and duplicate environment names', async ({
  sails,
  expect
}) => {
  const invalid = sails.helpers.setting.validate({
    envVars: { 'INVALID-KEY': 'value' }
  })
  const duplicates = sails.helpers.setting.validate({
    envVars: { API_KEY: 'second-value' },
    envSource: 'API_KEY=first-value\nAPI_KEY=second-value'
  })

  expect(Boolean(Object.assign({}, ...invalid).envVars)).toBe(true)
  expect(Boolean(Object.assign({}, ...duplicates).envVars)).toBe(true)
  expect(JSON.stringify(duplicates).includes('first-value')).toBe(false)
  expect(JSON.stringify(duplicates).includes('second-value')).toBe(false)
})

test('precognition validates only the requested field', async ({
  sails,
  expect
}) => {
  const request = {
    header(name) {
      if (name === 'Precognition-Validate-Only') return 'bucket'
      return undefined
    }
  }
  const problems = sails.helpers.setting.validate(
    {
      provider: 'r2',
      accessKey: '',
      secretKey: '',
      bucket: 'valid-bucket',
      endpoint: ''
    },
    ['provider', 'accessKey', 'secretKey', 'bucket', 'endpoint'],
    request
  )

  expect(problems).toEqual([])
})
