const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const run = require('node:util').promisify(
  require('node:child_process').execFile
)
const UUID = '11111111-1111-4111-8111-111111111111'
const SECRET = 'never-print-this-fixture-secret'
async function execute(args, fixture, { setup = '', files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-reliability-'))
  const cli = path.resolve('packages/cli/src/index.js')
  fs.mkdirSync(path.join(root, '.slipway'))
  fs.writeFileSync(
    path.join(root, '.slipway/config.json'),
    JSON.stringify({ token: SECRET, server: 'https://fixture.invalid' })
  )
  fs.writeFileSync(path.join(root, 'command.txt'), 'node --version')
  for (const [name, value] of Object.entries(files))
    fs.writeFileSync(path.join(root, name), value)
  const runner = path.join(root, 'runner.mjs')
  fs.writeFileSync(
    runner,
    `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; import assert from 'node:assert/strict'; os.homedir=()=>${JSON.stringify(
      root
    )}; syncBuiltinESMExports(); process.chdir(${JSON.stringify(
      root
    )}); process.argv=['node',${JSON.stringify(cli)},...${JSON.stringify(
      args
    )}]; ${setup}; globalThis.fetch=async(url,options)=>{${fixture}}; await import(${JSON.stringify(
      cli
    )});`
  )
  let result
  try {
    try {
      result = {
        ...(await run(process.execPath, [runner], { timeout: 10000 })),
        code: 0
      }
    } catch (error) {
      result = { stdout: error.stdout, stderr: error.stderr, code: error.code }
    }
    result.files = Object.fromEntries(
      ['arm.txt', 'receipt.json']
        .filter((name) => fs.existsSync(path.join(root, name)))
        .map((name) => [
          name,
          {
            text: fs.readFileSync(path.join(root, name), 'utf8'),
            mode: fs.statSync(path.join(root, name)).mode & 0o777
          }
        ])
    )
    return result
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
const json = (body) =>
  `return new Response(${JSON.stringify(
    JSON.stringify(body)
  )},{headers:{'content-type':'application/json'}});`
const stream = (events) =>
  `return new Response(${JSON.stringify(
    events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  )},{headers:{'content-type':'application/x-ndjson'}});`
const app = {
  id: 42,
  slug: 'worker',
  name: 'Worker',
  status: 'running',
  containerName: 'worker-container',
  secureEnvVars: { PRIVATE: SECRET },
  envVars: { PRIVATE: SECRET },
  bridgeSecret: SECRET,
  resourceLimits: { cpus: '1', memory: '512m', secret: SECRET }
}
const target = ['--project', 'harbor', '--env', 'production', '--app', 'worker']
test('apps and inspect print only allowed app fields and never fall back from a missing explicit app', async () => {
  for (const command of ['apps', 'app:inspect']) {
    const result = await execute(
      [command, ...target, '--json'],
      `assert.equal(url,'https://fixture.invalid/api/v1/projects/harbor/environments/production/apps'); ${json(
        { apps: [app] }
      )}`
    )
    assert.equal(result.code, 0, result.stderr)
    assert.ok(!result.stdout.includes(SECRET))
    const data = JSON.parse(result.stdout)
    assert.equal((data.app || data.apps[0]).slug, 'worker')
  }
  const missing = await execute(
    ['app:inspect', ...target, '--json'],
    json({ apps: [{ ...app, slug: 'web' }] })
  )
  assert.equal(missing.code, 1)
  assert.equal(JSON.parse(missing.stderr).error.code, 'APP_NOT_FOUND')
})
test('app restart requires exact target approval and propagates inspected and unconfirmed failures', async () => {
  const blocked = await execute(
    ['app:restart', ...target, '--json'],
    `throw new Error('Unexpected mutation');`
  )
  assert.equal(blocked.code, 1)
  assert.equal(
    JSON.parse(blocked.stderr).error.code,
    'TARGET_APPROVAL_REQUIRED'
  )
  const args = [
    'app:restart',
    ...target,
    '--approve-target',
    'harbor/production/worker',
    '--json'
  ]
  const okay = await execute(
    args,
    `if(options.method==='GET'){${json({
      apps: [app]
    })}} assert.equal(url,'https://fixture.invalid/api/v1/projects/harbor/environments/production/apps/worker/restart'); assert.equal(options.method,'POST'); ${json(
      { message: 'App restarted' }
    )}`
  )
  assert.equal(okay.code, 0, okay.stderr)
  assert.equal(JSON.parse(okay.stdout).restarted, true)
  const lost = await execute(
    args,
    `if(options.method==='GET'){${json({
      apps: [app]
    })}} throw new Error('Connection lost');`
  )
  assert.equal(lost.code, 1)
  assert.equal(JSON.parse(lost.stderr).error.code, 'RESTART_UNCONFIRMED')
})
test('cancellation reports true and ambiguous false without fabricating completed status', async () => {
  for (const cancelled of [true, false]) {
    const result = await execute(
      ['run:cancel', UUID, '--json'],
      `assert.equal(url,'https://fixture.invalid/api/v1/helm/executions/${UUID}/cancel'); assert.equal(options.method,'POST'); ${json(
        { cancelled }
      )}`
    )
    assert.equal(result.code, cancelled ? 0 : 1)
    assert.equal(JSON.parse(result.stdout).cancelled, cancelled)
    assert.ok(!JSON.parse(result.stdout).status)
  }
  const bad = await execute(
    ['run:cancel', 'not-a-uuid', '--json'],
    `throw new Error('Should not fetch');`
  )
  assert.equal(bad.code, 1)
})
test('history returns metadata without command source, output, or execution lookup claims', async () => {
  const result = await execute(
    ['run:history', ...target, '--ndjson'],
    `assert.equal(url,'https://fixture.invalid/api/v1/projects/harbor/environments/production/helm/history?mode=command&appSlug=worker'); ${json(
      {
        entries: [
          {
            id: 3,
            status: 'unconfirmed',
            durationMs: 4,
            source: SECRET,
            stdout: SECRET,
            targetContext: { secret: SECRET },
            targetLabel: 'production / worker'
          }
        ],
        retentionDays: 30
      }
    )}`
  )
  assert.equal(result.code, 0, result.stderr)
  assert.ok(!result.stdout.includes(SECRET))
  const data = JSON.parse(result.stdout)
  assert.equal(data.executionLookup, false)
  assert.equal(data.entries[0].status, 'unconfirmed')
})
test('guarded arming requires reviewed target, keeps token only in private exclusive file, and uses server TTL', async () => {
  const args = [
    'run:arm',
    ...target,
    '--file',
    'command.txt',
    '--output',
    'arm.txt',
    '--json'
  ]
  const blocked = await execute(args, `throw new Error('Should not fetch');`)
  assert.equal(blocked.code, 1)
  assert.equal(blocked.files['arm.txt'], undefined)
  const approved = [...args, '--approve-target', 'harbor/production/worker']
  const expiresAt = Date.now() + 60000
  const fixture = `if(options.method==='GET'){${json({
    apps: [app]
  })}} assert.equal(url,'https://fixture.invalid/api/v1/projects/harbor/environments/production/helm/arm-writes'); assert.deepEqual(JSON.parse(options.body),{mode:'command',code:'node --version',appSlug:'worker'}); ${json(
    { token: SECRET, sourceHash: 'fixture-hash', expiresAt }
  )}`
  const armed = await execute(approved, fixture)
  assert.equal(armed.code, 0, armed.stderr)
  assert.equal(armed.files['arm.txt'].mode, 0o600)
  assert.equal(armed.files['arm.txt'].text, SECRET + '\n')
  assert.equal(JSON.parse(armed.stdout).expiresAt, expiresAt)
  assert.ok(!armed.stdout.includes(SECRET))
  assert.ok(!armed.stderr.includes(SECRET))
  const exists = await execute(approved, fixture, {
    files: { 'arm.txt': 'existing' }
  })
  assert.equal(exists.code, 1)
  assert.equal(exists.files['arm.txt'].text, 'existing')
  const denied = await execute(
    approved,
    `if(options.method==='GET'){${json({
      apps: [app]
    })}} return new Response(JSON.stringify({message:'Denied'}),{status:403});`
  )
  assert.equal(denied.code, 1)
  assert.equal(JSON.parse(denied.stderr).error.status, 403)
})
test('private client receipts retain accepted UUID/target and terminal metadata without source/logs/secrets', async () => {
  const args = [
    'run',
    ...target,
    '--file',
    'command.txt',
    '--receipt-file',
    'receipt.json',
    '--json'
  ]
  const events = [
    {
      type: 'accepted',
      executionId: UUID,
      target: {
        project: { slug: 'harbor', secret: SECRET },
        environment: { slug: 'production' },
        app: { slug: 'worker' },
        secret: SECRET
      }
    },
    { type: 'stdout', text: SECRET },
    {
      type: 'result',
      result: {
        success: true,
        status: 'success',
        exitCode: 0,
        stdout: SECRET,
        output: SECRET,
        terminationConfirmed: true
      }
    }
  ]
  const result = await execute(
    args,
    `const body=JSON.parse(options.body); assert.ok(body.executionId); ${stream(
      events
    )}`
  )
  assert.equal(result.code, 0, result.stderr)
  const receipt = JSON.parse(result.files['receipt.json'].text)
  assert.equal(result.files['receipt.json'].mode, 0o600)
  assert.equal(receipt.status, 'finished')
  assert.match(receipt.executionId, /^[0-9a-f-]{36}$/)
  assert.equal(receipt.target.app.slug, 'worker')
  assert.ok(!result.files['receipt.json'].text.includes(SECRET))
  const lost = await execute(
    args,
    stream([
      { type: 'accepted', target: { app: { slug: 'worker' } } },
      { type: 'stdout', text: SECRET }
    ])
  )
  assert.equal(lost.code, 1)
  assert.equal(
    JSON.parse(lost.files['receipt.json'].text).status,
    'unconfirmed'
  )
  const exists = await execute(args, `throw new Error('Should not execute');`, {
    files: { 'receipt.json': 'keep' }
  })
  assert.equal(exists.code, 1)
  assert.equal(exists.files['receipt.json'].text, 'keep')
})
test('doctor verifies server, saved auth, and actual canDeploy readiness with meaningful failure exit', async () => {
  const fixture = `if(url.endsWith('/health')){${json({
    status: 'ok',
    version: 'fixture-version'
  })}} if(url.endsWith('/projects')){${json({
    projects: []
  })}} assert.equal(url,'https://fixture.invalid/api/v1/projects/harbor/environments/production/readiness?app=worker'); ${json(
    { canDeploy: true, summary: { blocker: 0 }, items: [] }
  )}`
  const okay = await execute(['doctor', ...target, '--json'], fixture)
  assert.equal(okay.code, 0, okay.stderr)
  assert.equal(JSON.parse(okay.stdout).ok, true)
  assert.ok(!okay.stdout.includes(SECRET))
  const denied = await execute(
    ['doctor', '--json'],
    `if(url.endsWith('/health')){${json({
      status: 'ok',
      version: 'fixture'
    })}} return new Response(JSON.stringify({message:'Authentication required'}),{status:401});`
  )
  assert.equal(denied.code, 1)
  assert.equal(
    JSON.parse(denied.stdout).checks.find(
      (check) => check.name === 'authentication'
    ).ok,
    false
  )
  const blocked = await execute(
    ['doctor', ...target, '--json'],
    fixture.replace(
      json({ canDeploy: true, summary: { blocker: 0 }, items: [] }),
      json({ canDeploy: false, summary: { blocker: 1 }, items: [] })
    )
  )
  assert.equal(blocked.code, 1)
})
