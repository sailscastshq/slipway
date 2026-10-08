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
  hook.remember({ key: 'smtpUsername', encryptedValue: 'kelvin@example.test' })
  hook.remember({
    envVars: {
      LEGACY_LABEL: 'sailsconf',
      STORAGE_LABEL: 'files.example.test',
      OWNER_LABEL: 'sailscasts'
    }
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
      connectedRepo: {
        id: 7,
        owner: 'sailscastshq',
        name: 'chieflevite',
        fullName: 'sailscastshq/chieflevite',
        htmlUrl: 'https://github.com/sailscastshq/chieflevite'
      },
      app: {
        fullDomain: 'sailsconf.com',
        generatedDomain: 'sailsconf-production.slipway.test',
        domains: ['sailsconf.com', 'sailsconf-production.slipway.test'],
        primaryUrl: 'https://sailsconf.com',
        accessUrls: [
          {
            kind: 'custom',
            display: 'sailsconf.com',
            value: 'https://sailsconf.com',
            href: 'https://sailsconf.com'
          },
          {
            kind: 'generated',
            display: 'sailsconf-production.slipway.test',
            value: 'https://sailsconf-production.slipway.test',
            href: 'https://sailsconf-production.slipway.test'
          },
          {
            kind: 'direct',
            display: '127.0.0.1:1342',
            value: 'http://127.0.0.1:1342',
            href: 'http://127.0.0.1:1342'
          }
        ]
      },
      user: {
        id: 2,
        name: 'Kelvin',
        email: 'kelvin@example.test',
        photoUrl: 'https://files.example.test/users/2/photos/avatar.webp'
      },
      team: { logoUrl: 'https://files.example.test/teams/1/logo.webp' },
      smtpPassword: 'kelvin@example.test',
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
    expect(JSON.parse(JSON.stringify(result.props.connectedRepo))).toEqual(
      page.props.connectedRepo
    )
    expect(result.props.user.email).toBe('kelvin@example.test')
    expect(result.props.user.photoUrl).toBe(page.props.user.photoUrl)
    expect(result.props.team.logoUrl).toBe(page.props.team.logoUrl)
    expect(JSON.parse(JSON.stringify(result.props.app))).toEqual(page.props.app)
    expect(result.props.smtpPassword).toBe('[REDACTED]')
    expect(result.props.token).toBe('[REDACTED]')
    expect(result.props.envVars.APP_NAME).toBe('[REDACTED]')
    expect(result.props.envVars.API_TOKEN).toBe('[REDACTED]')
    expect(result.props.message).toBe('flossafrica [REDACTED]')
  }
})

test('repository identity exemptions require a consistent structured repository and never exempt clone credentials or unrelated full names', ({
  expect
}) => {
  const redact = createRedactor()
  redact.remember({
    envVars: { LABEL: 'sailscasts', TOKEN: 'github-canary-739' }
  })
  const repo = {
    id: '739',
    owner: 'sailscastshq',
    name: 'chieflevite',
    fullName: 'sailscastshq/chieflevite',
    htmlUrl: 'https://github.com/sailscastshq/chieflevite',
    cloneUrl:
      'https://user:github-canary-739@github.com/sailscastshq/chieflevite.git?token=github-canary-739',
    token: 'github-canary-739'
  }
  const result = redact.protect({
    repos: [repo],
    fullName: repo.fullName,
    owner: repo.owner,
    message: repo.fullName,
    invalid: { ...repo, name: 'different' },
    unsafe: {
      ...repo,
      htmlUrl:
        'https://user:github-canary-739@github.com/sailscastshq/chieflevite'
    }
  })
  expect(result.repos[0].fullName).toBe(repo.fullName)
  expect(result.repos[0].owner).toBe(repo.owner)
  expect(result.repos[0].htmlUrl).toBe(repo.htmlUrl)
  expect(result.repos[0].token).toBe('[REDACTED]')
  expect(result.repos[0].cloneUrl).toBe(
    'https://[REDACTED]@github.com/[REDACTED]hq/chieflevite.git?token=[REDACTED]'
  )
  expect(result.fullName).toBe('[REDACTED]hq/chieflevite')
  expect(result.owner).toBe('[REDACTED]hq')
  expect(result.message).toBe('[REDACTED]hq/chieflevite')
  expect(result.invalid.fullName).toBe('[REDACTED]hq/chieflevite')
  expect(result.unsafe.fullName).toBe('[REDACTED]hq/chieflevite')
  redact.remember({ key: 'webhookUrl', value: repo.htmlUrl })
  expect(redact.protect(repo).htmlUrl).toBe('[REDACTED]')
})

test('public routing URL fields still mask credentials and reject inconsistent access labels', ({
  expect
}) => {
  const redact = createRedactor()
  redact.remember({
    envVars: { LABEL: 'sailsconf', TOKEN: 'private-canary-736' }
  })
  const capability = 'https://sailsconf.com/private-capability'
  redact.remember({ key: 'webhookUrl', value: capability })
  const result = redact.protect({
    appUrl: 'https://sailsconf.com/private-canary-736',
    bridgeUrl: 'https://sailsconf.com/bridge?token=private-canary-736',
    primaryUrl: capability,
    directUrl: 'https://user:private-canary-736@sailsconf.com',
    domain: 'https://sailsconf.com/private-canary-736',
    accessUrls: [
      {
        kind: 'custom',
        display: 'private-canary-736',
        value: 'https://sailsconf.com',
        href: 'https://sailsconf.com'
      }
    ],
    password: 'https://sailsconf.com'
  })
  expect(result.appUrl).toBe('https://sailsconf.com/[REDACTED]')
  expect(result.bridgeUrl).toBe('https://sailsconf.com/bridge?token=[REDACTED]')
  expect(result.primaryUrl).toBe('[REDACTED]')
  expect(result.directUrl).toBe('https://[REDACTED]@[REDACTED].com')
  expect(result.domain).toBe('https://[REDACTED].com/[REDACTED]')
  expect(result.accessUrls[0].display).toBe('[REDACTED]')
  expect(result.password).toBe('[REDACTED]')
  expect(redact.text('sailsconf private-canary-736')).toBe(
    '[REDACTED] [REDACTED]'
  )
})

test('legacy public runtime values do not erase deployment URLs, but explicit secrets still do', ({
  expect
}) => {
  const redact = createRedactor()
  redact.remember({
    envVars: {
      NODE_ENV: 'production',
      APP_NAME: 'chieflevite',
      ODD_NAME: 'private-canary-734'
    }
  })
  const endpoint =
    'http://slipway-chieflevite-production-chieflevite-com-733:1337/health'
  expect(redact.text(`Health check: polling ${endpoint}`)).toBe(
    `Health check: polling ${endpoint}`
  )
  expect(redact.text('private-canary-734')).toBe('[REDACTED]')
  expect(
    redact.protect({ envVars: { NODE_ENV: 'production' } }).envVars.NODE_ENV
  ).toBe('[REDACTED]')
  redact.remember({
    envVars: { APP_NAME: 'private-name-734' },
    envVarMetadata: { APP_NAME: { kind: 'secret' } }
  })
  expect(redact.text('private-name-734')).toBe('[REDACTED]')
  redact.remember({
    envVars: { NODE_ENV: 'production' },
    envVarMetadata: { NODE_ENV: { kind: 'secret' } }
  })
  expect(redact.text(`${endpoint}?token=private-canary-734`)).toBe(
    `${endpoint}?token=[REDACTED]`
  )
  expect(redact.text('production private-name-734')).toBe(
    '[REDACTED] [REDACTED]'
  )
  expect(
    redact.text(
      'http://user:private-canary-734@slipway-chieflevite-production-chieflevite-com-733:1337/health'
    )
  ).toBe(
    'http://[REDACTED]@slipway-chieflevite-[REDACTED]-chieflevite-com-733:1337/health'
  )
  const webhook = 'http://slipway-private-webhook:1337/private-capability'
  redact.remember({ key: 'webhookUrl', value: webhook })
  expect(redact.text(`Failed request ${webhook}`)).toBe(
    'Failed request [REDACTED]'
  )
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

test('presentation uses credential provenance, not legacy configuration substring guesses', ({
  expect
}) => {
  const hook = require('../../../api/hooks/secrets')({})
  hook.remember({
    envVars: {
      BRAND: 'flossafrica',
      OWNER: 'kelvin@example.test',
      HOST: 'files.example.test'
    }
  })
  hook.remember({ key: 'smtpUsername', encryptedValue: 'kelvin@example.test' })
  hook.remember({
    key: 'legacyPreferences',
    encryptedValue: JSON.stringify({ label: 'flossafrica' })
  })
  hook.remember({
    envVars: {
      SIGNING: 'confirmed-canary-746',
      LEGACY_API_TOKEN: 'legacy-token-canary-746'
    },
    envVarMetadata: { SIGNING: { kind: 'secret' } }
  })
  const req = { options: { action: 'bearing/view-feedback' } }
  const res = {
    statusCode: 200,
    json: (value) => value,
    view: (name, locals) => locals,
    set() {},
    sse: () => ({ send: (value) => value })
  }
  hook.routes.before['/*'](req, res, () => {})
  const content = {
    title: 'Support flossafrica',
    arbitraryNewField: 'Help flossafrica grow. Contact kelvin@example.test.',
    body: '![flossafrica](https://files.example.test/flossafrica.webp)',
    link: 'https://flossafrica.com/bearing/updates',
    email: 'kelvin@example.test',
    example:
      'Use token=example and password=placeholder in the tutorial. Authorization: Bearer sample-token'
  }
  for (const safe of [
    res.json(content),
    res.view('app', { page: { props: content } }).page.props,
    res.sse().send(content)
  ])
    expect(JSON.parse(JSON.stringify(safe))).toEqual(content)
  const credentials = res.json({
    title: 'confirmed-canary-746 legacy-token-canary-746',
    name: 'confirmed-canary-746',
    domain: 'confirmed-canary-746.test',
    url: 'https://user:confirmed-canary-746@example.test/?token=legacy-token-canary-746',
    nested: { password: 'tiny', authorization: 'tiny' },
    envVars: { BRAND: 'flossafrica' },
    error: 'failed flossafrica kelvin@example.test',
    buildLogs: 'failed flossafrica confirmed-canary-746'
  })
  expect(credentials.title).toBe('[REDACTED] [REDACTED]')
  expect(credentials.name).toBe('[REDACTED]')
  expect(credentials.domain).toBe('[REDACTED].test')
  expect(credentials.url.includes('confirmed-canary-746')).toBe(false)
  expect(credentials.url.includes('legacy-token-canary-746')).toBe(false)
  expect(credentials.nested.password).toBe('[REDACTED]')
  expect(credentials.nested.authorization).toBe('[REDACTED]')
  expect(credentials.envVars.BRAND).toBe('[REDACTED]')
  expect(credentials.error).toBe('failed [REDACTED] [REDACTED]')
  expect(credentials.buildLogs).toBe('failed [REDACTED] [REDACTED]')
  res.statusCode = 500
  expect(res.json({ message: 'failed flossafrica' }).message).toBe(
    'failed [REDACTED]'
  )
  expect(hook.text('flossafrica kelvin@example.test')).toBe(
    '[REDACTED] [REDACTED]'
  )
})

test('SSR is preserved exactly for public props and discarded when credential props were sanitized', ({
  expect
}) => {
  const hook = require('../../../api/hooks/secrets')({})
  hook.remember({
    envVars: { BRAND: 'flossafrica' },
    password: 'ssr-canary-746'
  })
  const res = {
    statusCode: 200,
    json: (v) => v,
    view: (name, locals) => locals,
    set() {}
  }
  hook.routes.before['/*'](
    { options: { action: 'bearing/view-surface' } },
    res,
    () => {}
  )
  const ssr = {
    head: ['<title>Support flossafrica</title>'],
    body: '<h1>Support flossafrica</h1>'
  }
  expect(
    res.view('app', { page: { props: { title: 'Support flossafrica' } }, ssr })
      .ssr
  ).toBe(ssr)
  const sanitized = res.view('app', {
    page: { props: { password: 'ssr-canary-746' } },
    ssr: { body: '<b>ssr-canary-746</b>' }
  })
  expect(sanitized.page.props.password).toBe('[REDACTED]')
  expect(sanitized.ssr).toBe(null)
})

test('response credential sources retain encoding protection and scoped grants without treating encrypted public settings as credentials', ({
  expect
}) => {
  const hook = require('../../../api/hooks/secrets')({})
  const canary = 'source-canary-746-<>&'
  hook.remember({ key: 'smtpPassword', encryptedValue: canary })
  hook.remember({
    key: 'backupStorageConfig',
    encryptedValue: JSON.stringify({
      key: 'storage-access-746',
      secret: 'storage-secret-746',
      bucket: 'flossafrica',
      endpoint: 'https://files.example.test'
    })
  })
  hook.remember({
    key: 'webhookUrl',
    value: 'https://hooks.example.test/private-capability-746'
  })
  hook.remember({
    secureEnvVars: {
      BRAND: 'flossafrica',
      R2_PUBLIC_URL: 'https://files.example.test',
      LEGACY_API_TOKEN: 'legacy-credential-746'
    }
  })
  hook.remember({
    envVars: { R2_PUBLIC_URL: 'https://explicit-secret.test' },
    envVarMetadata: { R2_PUBLIC_URL: { kind: 'secret' } }
  })
  const req = { options: { action: 'dashboard/view-dashboard' } }
  const res = { statusCode: 200, json: (v) => v, set() {} }
  hook.routes.before['/*'](req, res, () => {})
  for (const text of [
    canary,
    encodeURIComponent(canary),
    Buffer.from(canary).toString('base64'),
    Buffer.from(canary).toString('base64url'),
    Buffer.from(canary).toString('hex'),
    JSON.stringify(canary).slice(1, -1),
    canary.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
  ])
    expect(res.json({ arbitraryNewField: text }).arbitraryNewField).toBe(
      '[REDACTED]'
    )
  const result = res.json({
    title: 'Support flossafrica',
    url: 'https://files.example.test/flossafrica.webp',
    privateLink: 'https://hooks.example.test/private-capability-746',
    storage: 'storage-access-746 storage-secret-746',
    token: 'tiny',
    nested: { error: new Error('flossafrica ' + canary) },
    env: { BRAND: 'flossafrica' },
    explicitUrl: 'https://explicit-secret.test',
    legacy: 'legacy-credential-746',
    errors: { password: 'flossafrica is not allowed' }
  })
  expect(result.title).toBe('Support flossafrica')
  expect(result.url).toBe('https://files.example.test/flossafrica.webp')
  expect(result.privateLink).toBe('[REDACTED]')
  expect(result.storage).toBe('[REDACTED] [REDACTED]')
  expect(result.token).toBe('[REDACTED]')
  expect(result.nested.error.message).toBe('[REDACTED] [REDACTED]')
  expect(result.env.BRAND).toBe('[REDACTED]')
  expect(result.explicitUrl).toBe('[REDACTED]')
  expect(result.legacy).toBe('[REDACTED]')
  expect(result.errors.password).toBe('[REDACTED] is not allowed')
  const failure = res.json({
    error: 'failed',
    message: 'flossafrica ' + canary,
    name: canary
  })
  expect(failure.message).toBe('[REDACTED] [REDACTED]')
  expect(failure.name).toBe('[REDACTED]')
  req.options.action = 'api/v1/configuration/reveal'
  expect(res.json({ value: canary }).value).toBe(canary)
  res.statusCode = 503
  expect(res.json({ value: canary, message: canary }).value).toBe('[REDACTED]')
  res.statusCode = 200
  expect(res.json({ value: canary, error: 'failed' }).value).toBe('[REDACTED]')
})

test('secret-variable annotations stay public and never seed response credential patterns', ({
  expect
}) => {
  const hook = require('../../../api/hooks/secrets')({})
  const metadata = {
    APP_SECRET: {
      kind: 'secret',
      previewPolicy: 'omit',
      description: 'Signing configuration for flossafrica',
      changedByName: 'Kelvin Omereshone'
    }
  }
  hook.remember({
    secureEnvVars: { APP_SECRET: 'metadata-credential-canary-746' },
    envVarMetadata: metadata
  })
  const res = { statusCode: 200, json: (v) => v, set() {} }
  hook.routes.before['/*'](
    { options: { action: 'project/view-app' } },
    res,
    () => {}
  )
  const safe = res.json({
    envVars: { APP_SECRET: 'metadata-credential-canary-746' },
    envVarMetadata: metadata,
    user: { fullName: 'Kelvin Omereshone' },
    description: metadata.APP_SECRET.description,
    actualCredential: 'metadata-credential-canary-746'
  })
  expect(JSON.parse(JSON.stringify(safe.envVarMetadata))).toEqual(metadata)
  expect(safe.user.fullName).toBe('Kelvin Omereshone')
  expect(safe.description).toBe(metadata.APP_SECRET.description)
  expect(hook.text(metadata.APP_SECRET.description)).toBe(
    metadata.APP_SECRET.description
  )
  expect(hook.text('Kelvin Omereshone metadata-credential-canary-746')).toBe(
    'Kelvin Omereshone [REDACTED]'
  )
  expect(safe.actualCredential).toBe('[REDACTED]')
  expect(safe.envVars.APP_SECRET).toBe('[REDACTED]')
})
