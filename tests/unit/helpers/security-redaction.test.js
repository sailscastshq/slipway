const assert = require('node:assert/strict')
const { performance } = require('node:perf_hooks')
const { test } = require('sounding')
const { createRedactor, preserveValues, publicValues } =
  require('../../../api/helpers/security/redact')._private

test('response redaction preserves public project names while masking matching credential values', ({
  expect
}) => {
  const hook = require('../../../api/hooks/secrets')({})
  hook.remember({
    appEnvVars: { APP_NAME: 'flossafrica', API_TOKEN: 'credential-canary-734' }
  })
  const request = { options: { action: 'dashboard/view-dashboard' } }
  const response = {
    statusCode: 200,
    json: (value) => value,
    view: (name, locals) => locals,
    set() {}
  }
  hook.routes.before['/*'](request, response, () => {})
  const page = {
    component: 'dashboard/index',
    props: {
      projects: [
        { id: 1, name: 'flossafrica', slug: 'flossafrica', status: 'running' }
      ],
      appName: 'flossafrica',
      token: 'flossafrica',
      envVars: { APP_NAME: 'flossafrica', API_TOKEN: 'credential-canary-734' },
      message: 'flossafrica credential-canary-734'
    }
  }
  for (const result of [
    response.json(page),
    response.view('app', { page }).page
  ]) {
    expect(result.props.projects[0].name).toBe('flossafrica')
    expect(result.props.appName).toBe('flossafrica')
    expect(result.props.token).toBe('[REDACTED]')
    expect(result.props.envVars.APP_NAME).toBe('[REDACTED]')
    expect(result.props.envVars.API_TOKEN).toBe('[REDACTED]')
    expect(result.props.message).toBe('[REDACTED] [REDACTED]')
  }
})

test('diagnostics mask nested credentials, URLs and common reversible encodings without changing control data', ({
  expect
}) => {
  const secret = 'secret-canary-<&-12-characters'
  const redact = createRedactor()
  redact.remember({ envVars: { ODD_NAME: secret } })
  redact.remember({ key: 'smtpPassword', value: 'legacy-smtp-canary-718' })
  redact.remember({
    key: 'webhookUrl',
    value: 'https://hooks.example.test/private-canary-718'
  })
  expect(
    redact.text(
      'legacy-smtp-canary-718 https://hooks.example.test/private-canary-718'
    )
  ).toBe('[REDACTED] [REDACTED]')
  redact.remember({
    key: 'globalEnvVars',
    encryptedValue: JSON.stringify({
      R2_PUBLIC_URL: 'https://assets.example.test',
      R2_SECRET_KEY: secret,
      S3_PUBLIC_URL: 'https://unsafe.example.test/?token=credential-718'
    })
  })
  redact.remember({
    key: 'backupStorageConfig',
    encryptedValue: JSON.stringify({
      endpoint: 'https://storage.example.test',
      secretKey: secret,
      key: 'backup-access-canary-718',
      accountKey: 'azure-account-canary-718'
    })
  })
  expect(redact.text('https://assets.example.test/bearing/tall.png')).toBe(
    'https://assets.example.test/bearing/tall.png'
  )
  expect(redact.text('https://storage.example.test')).toBe(
    'https://storage.example.test'
  )
  const ordinary = 'x.'.repeat(32000)
  const started = performance.now()
  expect(redact.text(ordinary)).toBe(ordinary)
  assert.ok(
    performance.now() - started < 500,
    'A normal 64 KiB diagnostic must not stall request processing'
  )
  expect(redact.text('custom+transport://user:pass@server/path')).toBe(
    'custom+transport://[REDACTED]@server/path'
  )
  expect(redact.text('backup-access-canary-718 azure-account-canary-718')).toBe(
    '[REDACTED] [REDACTED]'
  )
  expect(redact.text('https://unsafe.example.test/?token=credential-718')).toBe(
    '[REDACTED]'
  )
  for (const variant of [
    secret,
    encodeURIComponent(secret),
    Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('base64url'),
    Buffer.from(secret).toString('hex'),
    JSON.stringify(secret).slice(1, -1)
  ]) {
    expect(redact.text(`before ${variant} after`)).toBe(
      'before [REDACTED] after'
    )
  }
  const result = redact.protect({
    id: 22,
    status: 'running',
    count: 8,
    empty: null,
    at: new Date('2026-10-07T00:00:00Z'),
    envVars: { SHORT: 'x', MODE: 'production' },
    envVarMetadata: { MODE: { kind: 'plain' } },
    deployTokens: [{ id: 2, name: 'Release automation', tokenHash: secret }],
    hasCredentials: true,
    token: '',
    errors: { password: 'Password is required.', email: secret },
    nested: {
      password: 'x',
      authorization: 'Bearer abc',
      url: 'postgres://user:pass@db:5432/main',
      reason: new Error(secret)
    }
  })
  expect(result.envVars).toEqual({ SHORT: '[REDACTED]', MODE: 'production' })
  expect(result.nested.password).toBe('[REDACTED]')
  expect(result.nested.url).toBe('postgres://[REDACTED]@db:5432/main')
  expect(result.at).toBe('2026-10-07T00:00:00.000Z')
  expect(result.id).toBe(22)
  expect(result.count).toBe(8)
  expect(JSON.parse(JSON.stringify(result.deployTokens))).toEqual([
    { id: 2, name: 'Release automation', tokenHash: '[REDACTED]' }
  ])
  expect(result.hasCredentials).toBe(true)
  expect(result.token).toBe('')
  expect(result.errors).toEqual({
    password: 'Password is required.',
    email: '[REDACTED]'
  })
  expect(JSON.stringify(result).includes(secret)).toBe(false)
  expect(
    redact.text('https://s3.test/file?X-Amz-Credential=abc&X-Amz-Signature=def')
  ).toBe(
    'https://s3.test/file?X-Amz-Credential=[REDACTED]&X-Amz-Signature=[REDACTED]'
  )
})

test('hidden value edits preserve existing secrets and reject ambiguous or fabricated renames', ({
  expect
}) => {
  const current = { OLD: 'real-secret', KEEP: 'another-secret' }
  expect(
    preserveValues({ NEW: '[REDACTED]', KEEP: '[REDACTED]' }, current, {
      OLD: 'NEW'
    })
  ).toEqual({ NEW: 'real-secret', KEEP: 'another-secret' })
  assert.throws(() => preserveValues({ NEW: '[REDACTED]' }, current))
  assert.throws(() =>
    preserveValues({ OLD: '[REDACTED]', KEEP: '[REDACTED]' }, current, {
      OLD: 'KEEP'
    })
  )
  assert.throws(() => preserveValues([], current))
  expect(
    publicValues({ A: '', B: 'visible' }, { B: { kind: 'plain' } })
  ).toEqual({ A: '[REDACTED]', B: 'visible' })
})

test('redaction catalogue has a bounded fail-closed capacity', ({ expect }) => {
  const redact = createRedactor()
  redact.remember({ password: 'x'.repeat(5 * 1024 * 1024) })
  expect(redact.text('any diagnostic')).toBe(
    '[Diagnostic output withheld: redaction capacity exceeded]'
  )
})

test('command streams mask secrets split across chunks and withhold overlong lines', ({
  expect
}) => {
  const redact = createRedactor()
  redact.remember({ password: 'split-canary-secret-718' })
  const stream = redact.stream()
  expect(stream.write('start split-canary-')).toBe('')
  expect(stream.write('secret-718 end\n')).toBe('start [REDACTED] end\n')
  expect(stream.write('x'.repeat(70000))).toBe(
    '[Diagnostic line withheld: size limit exceeded]\n'
  )
  expect(stream.write('trailing secret\n')).toBe('')
  expect(stream.write('next')).toBe('')
  expect(stream.end()).toBe('next')
  const unicode = 'unicode-🔐-credential-718'
  redact.remember({ password: unicode })
  const utf8 = redact.stream()
  const bytes = Buffer.from(unicode + '\n')
  const boundary = Buffer.from('unicode-').length + 2
  expect(utf8.write(bytes.subarray(0, boundary))).toBe('')
  expect(utf8.write(bytes.subarray(boundary))).toBe('[REDACTED]\n')
})
