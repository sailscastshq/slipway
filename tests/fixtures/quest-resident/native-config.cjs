const assert = require('node:assert/strict')
const path = require('node:path')

const PIN = 'db02badda2b160acfedad5350e08f8b182968006'
const LIMITS = Object.freeze({
  lifetimeMs: 180000,
  bytes: 2 * 1024 * 1024,
  starts: 64,
  loads: 70,
  expectedStarts: 41,
  expectedLoads: 42,
  parallel: 4
})

function requireCI(env = process.env) {
  assert.equal(env.CI, 'true', 'Native restart proof requires CI=true')
  assert.equal(
    env.SLIPWAY_QUEST_RESTART_CI,
    '1',
    'Native restart proof requires SLIPWAY_QUEST_RESTART_CI=1'
  )
  assert.equal(process.platform, 'linux', 'Linux ownership checks are required')
}

// Explicit allowlist, never a spread of the runner environment. In particular,
// no CI credentials, inherited preload flags, proxies, cloud SDK settings,
// telemetry destinations or NODE_OPTIONS enter any app or Quest CLI child.
function childEnvironment({ root, context, evidence, appId, deploymentId }) {
  const env = {
    CI: 'true',
    SLIPWAY_QUEST_RESTART_CI: '1',
    NODE_ENV: 'test',
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: path.join(root, 'home'),
    TMPDIR: path.join(root, 'tmp'),
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    QUEST_NATIVE_CONTEXT: context,
    QUEST_NATIVE_EVIDENCE: evidence
  }
  if (appId !== undefined) env.SLIPWAY_APP_ID = String(appId)
  if (deploymentId !== undefined)
    env.SLIPWAY_DEPLOYMENT_ID = String(deploymentId)
  return env
}

function dashboardOptions({ repo, root, generation, port = 0 }) {
  assert.ok(['A', 'B'].includes(generation))
  assert.ok(Number.isInteger(port) && port >= 0 && port <= 65535)
  assert.ok(path.isAbsolute(root) && path.isAbsolute(repo))
  return {
    appPath: repo,
    environment: 'test',
    explicitHost: '127.0.0.1',
    host: '127.0.0.1',
    port,
    hooks: { lookout: false, quest: false, shipwright: false, sockets: false },
    log: { level: 'error', noShip: true },
    models: { migrate: generation === 'A' ? 'drop' : 'safe' },
    datastores: Object.fromEntries(
      ['default', 'observability', 'analytics', 'cache'].map((name) => [
        name,
        { adapter: 'sails-sqlite', url: path.join(root, `${name}.sqlite`) }
      ])
    ),
    session: { adapter: '@sailscastshq/connect-sqlite', url: ':memory:' },
    sounding: { datastore: { mode: 'inherit' }, request: { transport: 'http' } }
  }
}

function assertLoopback(url) {
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'http:')
  assert.equal(parsed.hostname, '127.0.0.1')
  assert.ok(Number(parsed.port) > 0)
  assert.equal(parsed.username, '')
  assert.equal(parsed.password, '')
  assert.equal(parsed.search, '')
  assert.equal(parsed.hash, '')
  return parsed
}

// residentRequest is the exported in-container transport primitive. Its real
// private-socket response still has the wire envelope; unlike request(), it
// does not unwrap data or convert resident errors for its caller.
function residentData(response) {
  if (response?.ok !== true)
    throw Object.assign(
      new Error(response?.error?.message || 'Native resident request failed'),
      {
        code: response?.error?.code || 'QUEST_UNAVAILABLE'
      }
    )
  assert.ok(response.data && typeof response.data === 'object')
  return response.data
}

module.exports = {
  PIN,
  LIMITS,
  requireCI,
  childEnvironment,
  dashboardOptions,
  assertLoopback,
  residentData
}
