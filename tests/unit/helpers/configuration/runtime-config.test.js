const { test } = require('sounding')

test('config metadata defaults secrets to omit and keeps plain config inheritable', async ({
  sails,
  expect
}) => {
  const metadata = sails.helpers.configuration.normalizeEnvVarMetadata.with({
    values: {
      API_SECRET: 'do-not-log-this',
      LOG_LEVEL: 'info'
    },
    metadata: {
      LOG_LEVEL: { kind: 'plain' }
    },
    changedBy: '7',
    changedByName: 'Builder'
  })

  expect(metadata.API_SECRET.kind).toBe('secret')
  expect(metadata.API_SECRET.previewPolicy).toBe('omit')
  expect(metadata.LOG_LEVEL.kind).toBe('plain')
  expect(metadata.LOG_LEVEL.previewPolicy).toBe('inherit')
  expect(metadata.API_SECRET.changedByName).toBe('Builder')
})

test('read-only metadata normalization resolves legacy policy without inventing history', async ({
  sails,
  expect
}) => {
  const missing = sails.helpers.configuration.normalizeEnvVarMetadata.with({
    values: { DATABASE_URL: 'postgresql://managed' },
    metadata: {},
    currentValues: { DATABASE_URL: 'postgresql://managed' },
    currentMetadata: {},
    managedKeys: ['DATABASE_URL'],
    now: 999,
    recordChanges: false
  })
  const partial = sails.helpers.configuration.normalizeEnvVarMetadata.with({
    values: { DATABASE_URL: 'postgresql://managed' },
    metadata: {
      DATABASE_URL: {
        kind: 'secret',
        changedAt: 123,
        changedBy: '7',
        changedByName: 'Builder'
      }
    },
    currentValues: { DATABASE_URL: 'postgresql://managed' },
    currentMetadata: {
      DATABASE_URL: {
        kind: 'secret',
        changedAt: 123,
        changedBy: '7',
        changedByName: 'Builder'
      }
    },
    managedKeys: ['DATABASE_URL'],
    now: 999,
    recordChanges: false
  })
  const reread = sails.helpers.configuration.normalizeEnvVarMetadata.with({
    values: { DATABASE_URL: 'postgresql://managed' },
    metadata: missing,
    currentValues: { DATABASE_URL: 'postgresql://managed' },
    currentMetadata: missing,
    managedKeys: ['DATABASE_URL'],
    now: 1000,
    recordChanges: false
  })

  expect(missing.DATABASE_URL).toEqual({
    kind: 'secret',
    managed: true,
    previewPolicy: 'omit'
  })
  expect(partial.DATABASE_URL).toEqual({
    kind: 'secret',
    managed: true,
    previewPolicy: 'omit',
    changedAt: 123,
    changedBy: '7',
    changedByName: 'Builder'
  })
  expect(reread).toEqual(missing)
})

test('accepted metadata mutations record the supplied actor and time', async ({
  sails,
  expect
}) => {
  const metadata = sails.helpers.configuration.normalizeEnvVarMetadata.with({
    values: { API_SECRET: 'new-value' },
    metadata: {
      API_SECRET: { kind: 'secret', previewPolicy: 'randomize' }
    },
    currentValues: { API_SECRET: 'old-value' },
    currentMetadata: {
      API_SECRET: { kind: 'secret', previewPolicy: 'omit' }
    },
    changedBy: '7',
    changedByName: 'Builder',
    now: 456
  })

  expect(metadata.API_SECRET).toEqual({
    kind: 'secret',
    managed: false,
    previewPolicy: 'randomize',
    changedAt: 456,
    changedBy: '7',
    changedByName: 'Builder'
  })
})

test('preview policy omits production secrets and regenerates selected values', async ({
  sails,
  expect
}) => {
  const sourceSecret = 'production-only-secret'
  const preview = sails.helpers.configuration.applyPreviewPolicy(
    {
      DATABASE_URL: sourceSecret,
      SESSION_SECRET: sourceSecret,
      LOG_LEVEL: 'debug'
    },
    {
      DATABASE_URL: { kind: 'secret', previewPolicy: 'omit' },
      SESSION_SECRET: { kind: 'secret', previewPolicy: 'randomize' },
      LOG_LEVEL: { kind: 'plain', previewPolicy: 'inherit' }
    }
  )

  expect(preview.values.DATABASE_URL).toBe(undefined)
  expect(preview.values.SESSION_SECRET === sourceSecret).toBe(false)
  expect(preview.values.SESSION_SECRET.length > 20).toBe(true)
  expect(preview.values.LOG_LEVEL).toBe('debug')
})

test('config diffs and fingerprints never contain secret values', async ({
  sails,
  expect
}) => {
  const oldSecret = 'old-private-value'
  const newSecret = 'new-private-value'
  const changes = sails.helpers.configuration.diffEnvVars(
    { API_SECRET: oldSecret },
    { API_SECRET: newSecret },
    { API_SECRET: { kind: 'secret', previewPolicy: 'omit' } },
    { API_SECRET: { kind: 'secret', previewPolicy: 'omit' } }
  )
  const fingerprint = sails.helpers.configuration.fingerprintRuntimeConfig.with(
    {
      values: { API_SECRET: newSecret, LOG_LEVEL: 'info' },
      manifest: [
        {
          key: 'API_SECRET',
          scope: 'app',
          kind: 'secret',
          managed: false,
          previewPolicy: 'omit'
        }
      ]
    }
  )

  expect(changes[0].operation).toBe('rotated')
  expect(fingerprint.hash.length).toBe(64)
  expect(fingerprint.manifest[0].key).toBe('API_SECRET')
  expect(fingerprint.manifest[1].scope).toBe('platform')
  expect(JSON.stringify({ changes, fingerprint }).includes(oldSecret)).toBe(
    false
  )
  expect(JSON.stringify({ changes, fingerprint }).includes(newSecret)).toBe(
    false
  )
})
