const assert = require('node:assert/strict')
const { test } = require('sounding')
const events = require('../../../api/lib/deployment-log-events')
const normalize =
  require('../../../api/helpers/configuration/normalize-env-var-metadata').fn
function fixture() {
  const hook = require('../../../api/hooks/secrets')({
    config: { session: { secret: 'synthetic-deployment-log-test-key' } }
  })
  const values = {
    APP_NAME: 'acaciaco',
    NODE_ENV: 'production',
    BASE_URL: 'https://acaciaco.example'
  }
  const metadata = normalize({ values, recordChanges: false })
  hook.remember({ envVars: values, envVarMetadata: metadata })
  return hook
}
test('default editor metadata stays conservative while authenticated deployment events retain public coordinates', () => {
  const hook = fixture()
  const name = 'slipway-acaciaco-production-acaciaco-example-775'
  const raw = String(events.containerStart(name))
  assert.match(hook.text(raw), /\[REDACTED\]/)
  const stored = hook.storeDeploymentLog(
    hook.encodeDeploymentEvent(events.containerStart(name), 775)
  )
  assert.equal(hook.renderDeploymentLog(stored, 775), raw)
  assert.equal(
    hook.renderDeploymentLog(stored, 776),
    '[Unverified deployment event]\n'
  )
  const url = events.accessUrl('URL', 'https://acaciaco.example')
  assert.equal(
    hook.renderDeploymentLog(hook.encodeDeploymentEvent(url, 775), 775),
    String(url)
  )
  const health = events.healthPassed(name, 1337, '/ready', 204, 1)
  assert.equal(
    hook.renderDeploymentLog(hook.encodeDeploymentEvent(health, 775), 775),
    String(health)
  )
  assert.equal(fixture().renderDeploymentLog(stored, 775), raw)
  assert.equal(
    hook.renderDeploymentLog('old [REDACTED] log\n', 775),
    'old [REDACTED] log\n'
  )
})
test('Docker output, marker replay and credential collisions cannot gain deployment provenance', () => {
  const hook = fixture()
  const name = 'slipway-acaciaco-production-acaciaco-example-775'
  const stored = hook.encodeDeploymentEvent(events.containerStart(name), 775)
  const replay = hook.encodeDeploymentEvent(stored, 775)
  assert.match(replay, /\\u001e/)
  assert.doesNotMatch(
    hook.renderDeploymentLog(replay, 775),
    /Starting container/
  )
  const cut = stored.indexOf('.') + 1
  const splitReplay =
    hook.encodeDeploymentEvent(stored.slice(0, cut), 775) +
    hook.encodeDeploymentEvent(stored.slice(cut), 775)
  assert.doesNotMatch(
    hook.renderDeploymentLog(splitReplay, 775),
    /Starting container/
  )
  const tampered = stored.replace('v1.', 'v1.x')
  assert.equal(
    hook.renderDeploymentLog(tampered, 775),
    '[Unverified deployment event]\n'
  )
  hook.remember({
    envVars: { API_TOKEN: 'acaciaco', OTHER_PASSWORD: 'production' }
  })
  const safe = hook.renderDeploymentLog(stored, 775)
  assert.doesNotMatch(safe, /acaciaco|production/)
  assert.match(safe, /\[REDACTED\]/)
  assert.match(
    hook.renderDeploymentLog(
      hook.encodeDeploymentEvent(String(events.containerStart(name)), 775),
      775
    ),
    /\[REDACTED\]/
  )
})
test('userinfo, query and signed URLs remain untrusted with registered credential variants masked', () => {
  const hook = fixture()
  const token = 'synthetic-credential-canary'
  hook.remember({ envVars: { API_TOKEN: token } })
  for (const url of [
    `https://user:${token}@acaciaco.example`,
    `https://acaciaco.example/?token=${token}`,
    `https://acaciaco.example/?X-Amz-Signature=${token}`,
    `https://acaciaco.example/${Buffer.from(token).toString('base64url')}`
  ]) {
    const output = hook.renderDeploymentLog(
      hook.encodeDeploymentEvent(events.accessUrl('URL', url), 775),
      775
    )
    assert.doesNotMatch(output, /synthetic-credential-canary/)
    assert.match(output, /\[REDACTED\]/)
  }
  const event = events.accessUrl('URL', 'https://acaciaco.example')
  hook.remember({ envVars: { API_TOKEN: 'https://acaciaco.example' } })
  assert.doesNotMatch(
    hook.renderDeploymentLog(hook.encodeDeploymentEvent(event, 775), 775),
    /acaciaco/
  )
})
module.exports.fixture = fixture

test('explicit coordinate credentials and key rotation fail closed', () => {
  const hook = fixture()
  const stored = hook.encodeDeploymentEvent(
    events.containerStart('slipway-acaciaco-production-775'),
    775
  )
  hook.remember({
    envVars: { APP_NAME: 'acaciaco' },
    envVarMetadata: { APP_NAME: { kind: 'secret', redaction: 'credential' } }
  })
  assert.doesNotMatch(hook.renderDeploymentLog(stored, 775), /acaciaco/)
  const rotated = events.createCodec({
    secret: 'a-new-synthetic-key',
    diagnosticText: hook.text,
    credentialText: (value) => value
  })
  assert.equal(rotated.render(stored, 775), '[Unverified deployment event]\n')
  const res = { statusCode: 500, json: (value) => value, set() {} }
  hook.routes.before['/*'](
    { options: { action: 'api/v1/deploy/get-deployment-logs' } },
    res,
    () => {}
  )
  const safe = res.json({ deploymentId: 775, deployLogs: stored }).deployLogs
  assert.match(safe, /production/)
  assert.doesNotMatch(safe, /acaciaco|SlipwayDeploymentEvent/)
})
