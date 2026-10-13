const assert = require('node:assert/strict')
const { performance } = require('node:perf_hooks')
const { test } = require('sounding')
const { fromRecord } = require('../../../api/lib/public-log-identifiers')
const fixture = require('../../support/public-log-identifiers-fixture')
const lines = [
  'Refreshing source from publicownerhq/acaciaco.example (main)...',
  'Cloning git@github.com:publicownerhq/acaciaco.example.git (branch: main)...',
  '#12 naming to docker.io/slipway/acaciaco-production-acaciaco-example:123 done',
  'Running container: slipway-acaciaco-production-acaciaco-example-123',
  '.tmp/public/images/blog/introducing-acaciaco.jpg 47.0 kB',
  'Deployment 123 cancelled by operator@example.test'
]
test('verified control-plane identity preserves source, image, asset and actor log spans across stream and response boundaries', () => {
  const { hook, values } = fixture()
  const line = lines.join('\n') + `\n${values.ODD_NAME} ${values.API_TOKEN}\n`
  const stream = hook.stream()
  let captured = ''
  for (let offset = 0; offset < Buffer.byteLength(line); offset += 7)
    captured += stream.write(Buffer.from(line).subarray(offset, offset + 7))
  captured += stream.end()
  assert.equal(captured, lines.join('\n') + '\n[REDACTED] [REDACTED]\n')
  assert.equal(hook.protect(captured), captured)
  assert.equal(hook.storeDeploymentLog(captured), captured)
  assert.equal(hook.renderDeploymentLog(captured, 123), captured)
  const res = { statusCode: 500, json: (value) => value, set() {} }
  hook.routes.before['/*']({ options: {} }, res, () => {})
  assert.equal(res.json({ buildLogs: captured }).buildLogs, captured)
  assert.equal(res.json({ envVars: values }).envVars.APP_NAME, '[REDACTED]')
})
test('a public longer match never shadows credentials; unknown and encoded secrets remain masked', () => {
  const { hook, values } = fixture()
  hook.remember({
    password: 'publicowner',
    envVars: { NODE_ENV: 'production' },
    envVarMetadata: { NODE_ENV: { kind: 'secret', redaction: 'credential' } }
  })
  hook.remember({
    envVars: { PROJECT_NAME: 'publicownerhq' },
    envVarMetadata: { PROJECT_NAME: { kind: 'secret' } }
  })
  const safe = hook.text(
    'publicownerhq/acaciaco.example production ' + values.ODD_NAME
  )
  assert.equal(safe, '[REDACTED]hq/acaciaco.example [REDACTED] [REDACTED]')
  for (const value of [values.ODD_NAME, values.API_TOKEN])
    for (const encoded of [
      value,
      encodeURIComponent(value),
      Buffer.from(value).toString('base64'),
      Buffer.from(value).toString('hex')
    ])
      assert.equal(hook.text(encoded), '[REDACTED]')
  // A secret spanning public identity must be masked as a whole.
  hook.remember({ envVars: { CUSTOM: 'private-acaciaco-value' } })
  assert.equal(hook.text('private-acaciaco-value'), '[REDACTED]')
})
test('unclassified defaults alone, malformed records and URL credentials cannot establish public identity', () => {
  const hook = require('../../../api/hooks/secrets')({})
  hook.remember({ envVars: { BRAND: 'acaciaco' } })
  assert.equal(
    hook.text('introducing-acaciaco.jpg'),
    'introducing-[REDACTED].jpg'
  )
  for (const [kind, record] of [
    ['project', { slug: 'acaciaco' }],
    ['envVars', { id: 1, slug: 'acaciaco' }],
    ['project', { id: 1, slug: 'acaciaco\ninjected' }],
    [
      'gitrepository',
      { id: 1, owner: 'acaciaco', name: 'repo', fullName: 'mismatch/repo' }
    ],
    ['user', { id: 1, email: 'https://user:secret@example.test' }]
  ])
    assert.deepEqual(fromRecord(kind, record), [])
  hook.rememberPublicRecord('project', { id: 1, slug: 'acaciaco' })
  assert.equal(
    hook.text('https://user:fake-password@acaciaco.example/?token=fake-token'),
    'https://[REDACTED]@[REDACTED].example/?token=[REDACTED]'
  )
  assert.equal(hook.text('password=acaciaco'), 'password=[REDACTED]')
  assert.equal(hook.text('Bearer acaciaco'), 'Bearer [REDACTED]')
})
test('public matching stays bounded for repeated public identifiers in a 64 KiB log line', () => {
  const { hook } = fixture()
  const line = 'acaciaco '.repeat(7000)
  const started = performance.now()
  assert.equal(hook.text(line), line)
  assert.ok(performance.now() - started < 500)
})

test('restart loads public identity before logger wrapping and never grants configuration-only words', async () => {
  const captured = []
  const records = {
    project: [{ id: 1, name: 'Acaciaco', slug: 'acaciaco' }],
    environment: [
      {
        id: 2,
        name: 'Production',
        slug: 'production',
        envVars: {
          APP_NAME: 'acaciaco',
          NODE_ENV: 'production',
          ODD_NAME: 'startup-private-canary-768',
          API_TOKEN: 'confirmed-startup-canary-768'
        }
      }
    ],
    gitrepository: [
      {
        id: 3,
        owner: 'publicownerhq',
        name: 'acaciaco.example',
        fullName: 'publicownerhq/acaciaco.example'
      }
    ],
    user: [{ id: 4, email: 'operator@example.test' }]
  }
  const models = Object.fromEntries(
    Object.entries(records).map(([kind, entries]) => [
      kind,
      {
        attributes: Object.fromEntries(
          Object.keys(entries[0]).map((key) => [key, {}])
        ),
        find() {
          let fields = [],
            offset = 0,
            limit = 100
          const query = {
            select(value) {
              fields = value
              return this
            },
            sort() {
              return this
            },
            skip(value) {
              offset = value
              return this
            },
            limit(value) {
              limit = value
              return this
            },
            then(resolve, reject) {
              return Promise.resolve(
                entries
                  .slice(offset, offset + limit)
                  .map((row) =>
                    Object.fromEntries(
                      ['id', ...fields].map((key) => [key, row[key]])
                    )
                  )
              ).then(resolve, reject)
            },
            decrypt() {
              return this
            }
          }
          return query
        }
      }
    ])
  )
  const fakeSails = {
    config: { session: { secret: 'synthetic-startup-session-key' } },
    models,
    helpers: { setting: { get: async () => '{}' } },
    log: Object.fromEntries(
      ['error', 'warn', 'info', 'debug', 'verbose', 'silly'].map((level) => [
        level,
        (...args) => captured.push(args)
      ])
    ),
    after(_event, callback) {
      callback()
    }
  }
  const hook = require('../../../api/hooks/secrets')(fakeSails)
  await new Promise((resolve, reject) =>
    hook.initialize((error) => (error ? reject(error) : resolve()))
  )
  fakeSails.log.info(
    'Running container: slipway-acaciaco-production-acaciaco-example-123'
  )
  fakeSails.log.info(
    'Source publicownerhq/acaciaco.example by operator@example.test'
  )
  fakeSails.log.info('startup-private-canary-768 confirmed-startup-canary-768')
  assert.deepEqual(captured, [
    ['Running container: slipway-acaciaco-production-acaciaco-example-123'],
    ['Source publicownerhq/acaciaco.example by operator@example.test'],
    ['[REDACTED] [REDACTED]']
  ])
})

test('unknown hidden values equal public identity remain masked in uncontrolled output across apps', () => {
  const { hook } = fixture()
  hook.remember({ envVars: { ODD_NAME: 'acaciaco' } })
  assert.equal(hook.text('acaciaco'), '[REDACTED]')
  assert.equal(
    hook.text('introducing-acaciaco.jpg'),
    'introducing-[REDACTED].jpg'
  )
  hook.rememberPublicRecord('project', { id: 99, slug: 'other-app' })
  hook.remember({ envVars: { CUSTOM_OTHER_APP: 'production' } })
  assert.equal(
    hook.text('slipway-acaciaco-production-123'),
    'slipway-[REDACTED]-[REDACTED]-123'
  )
})
test('overlapping unknown values and genuine credentials are masked as original-input unions', () => {
  const hook = require('../../../api/hooks/secrets')({})
  hook.remember({
    envVars: { ODD: 'prefix-publicproject' },
    password: 'publicproject-private-tail'
  })
  hook.rememberPublicRecord('project', { id: 1, slug: 'publicproject' })
  assert.equal(hook.text('prefix-publicproject-private-tail'), '[REDACTED]')
  hook.remember({ envVars: { OTHER: 'private-tail-suffix' } })
  assert.equal(
    hook.text('prefix-publicproject-private-tail-suffix'),
    '[REDACTED]'
  )
})
test('misleading public-coordinate names and explicit cross-app credentials cannot gain a public exception', () => {
  const { hook } = fixture()
  hook.remember({
    envVars: {
      APP_NAME: 'fake-sensitive-app-name',
      EMAIL_DOMAIN: 'fake-private-domain.test'
    },
    envVarMetadata: {
      APP_NAME: { kind: 'secret' },
      EMAIL_DOMAIN: { kind: 'secret' }
    }
  })
  assert.equal(
    hook.text('fake-sensitive-app-name fake-private-domain.test'),
    '[REDACTED] [REDACTED]'
  )
  hook.remember({
    envVars: { APP_NAME: 'acaciaco' },
    envVarMetadata: { APP_NAME: { kind: 'secret', redaction: 'credential' } }
  })
  assert.equal(
    hook.text('introducing-acaciaco.jpg'),
    'introducing-[REDACTED].jpg'
  )
})

test('raw env maps need public record evidence and diagnostic structured identities cannot override credentials', () => {
  const hook = require('../../../api/hooks/secrets')({})
  hook.remember({
    env: {
      APP_NAME: 'publicproject',
      PROJECT_NAME: 'privateproject',
      NODE_ENV: 'production'
    }
  })
  assert.equal(
    hook.text('publicproject privateproject production'),
    '[REDACTED] [REDACTED] [REDACTED]'
  )
  hook.rememberPublicRecord('project', { id: 1, slug: 'publicproject' })
  assert.equal(
    hook.text('publicproject privateproject production'),
    'publicproject [REDACTED] [REDACTED]'
  )
  hook.remember({ password: 'publicproject' })
  const structured = hook.protect({
    slug: 'publicproject',
    containerName: 'slipway-publicproject-123',
    domain: 'publicproject.example',
    repo: {
      id: 1,
      owner: 'publicproject',
      name: 'repo',
      fullName: 'publicproject/repo'
    }
  })
  assert.equal(structured.slug, '[REDACTED]')
  assert.equal(structured.containerName, 'slipway-[REDACTED]-123')
  assert.equal(structured.domain, '[REDACTED].example')
  assert.equal(structured.repo.owner, '[REDACTED]')
  assert.equal(structured.repo.fullName, '[REDACTED]/repo')
})
