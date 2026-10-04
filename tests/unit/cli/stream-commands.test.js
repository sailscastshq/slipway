const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const run = require('node:util').promisify(
  require('node:child_process').execFile
)
async function execute(args, fixture, setup = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-stream-cli-'))
  const cli = path.resolve('packages/cli/src/index.js')
  fs.mkdirSync(path.join(root, '.slipway'))
  fs.writeFileSync(
    path.join(root, '.slipway/config.json'),
    JSON.stringify({
      token: 'fixture-secret',
      server: 'https://fixture.invalid'
    })
  )
  fs.writeFileSync(path.join(root, 'code.txt'), 'node --version')
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
  try {
    try {
      return { ...(await run(process.execPath, [runner])), code: 0 }
    } catch (error) {
      return { stdout: error.stdout, stderr: error.stderr, code: error.code }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
const response = (body, format = 'application/x-ndjson') =>
  `return new Response(${JSON.stringify(
    body
  )}, {headers:{'content-type':${JSON.stringify(format)}}});`
test('CLI run uses explicit targeting and file input, parses chunked NDJSON, and propagates command exit', async () => {
  const events = [
    { type: 'stdout', text: 'ready\n' },
    {
      type: 'result',
      result: { success: false, status: 'failed', exitCode: 7 }
    }
  ]
  const result = await execute(
    [
      'run',
      '--project',
      'harbor',
      '--env',
      'staging',
      '--app',
      'worker',
      '--file',
      'code.txt',
      '--json'
    ],
    `assert.equal(url,'https://fixture.invalid/api/v1/projects/harbor/environments/staging/helm/commands'); const body=JSON.parse(options.body); assert.equal(body.code,'node --version'); assert.equal(body.appSlug,'worker'); assert.match(body.executionId,/^[0-9a-f-]{36}$/); ${response(
      events.map((e) => JSON.stringify(e)).join('\n')
    )}`
  )
  assert.equal(result.code, 7)
  assert.equal(JSON.parse(result.stdout).result.exitCode, 7)
  assert.equal(result.stderr, '')
})
test('CLI run emits NDJSON unchanged and fails on missing receipts or guarded production denial', async () => {
  const args = ['run', 'node --version', '--project', 'harbor', '--ndjson']
  const events = [
    { type: 'stdout', text: 'okay\n' },
    { type: 'result', result: { success: true, exitCode: 0 } }
  ]
  const okay = await execute(
    args,
    response(events.map((e) => JSON.stringify(e)).join('\n') + '\n')
  )
  assert.equal(okay.code, 0)
  assert.deepEqual(okay.stdout.trim().split('\n').map(JSON.parse), events)
  const missing = await execute(args, response('{"type":"started"}\n'))
  assert.equal(missing.code, 1)
  assert.match(JSON.parse(missing.stderr).error.message, /without an outcome/)
  const denied = await execute(
    args,
    `return new Response(JSON.stringify({code:'HELM_WRITES_NOT_ARMED',message:'Arm exact command first.'}),{status:409});`
  )
  assert.equal(denied.code, 1)
  assert.equal(JSON.parse(denied.stderr).error.code, 'HELM_WRITES_NOT_ARMED')
  assert.ok(!denied.stderr.includes('fixture-secret'))
})
test('CLI log snapshot uses app-specific stream and handles split SSE frames', async () => {
  const result = await execute(
    ['logs', '--project', 'harbor', '--app', 'worker', '--tail', '2', '--json'],
    `assert.equal(url,'https://fixture.invalid/api/v1/projects/harbor/environments/production/apps/worker/logs/stream?tail=2&follow=false'); const enc=new TextEncoder(); return new Response(new ReadableStream({start(c){ for(const chunk of ['data: {"connected":true}\\r\\n\\r\\ndata: {"log":','"one"}\\r\\n\\r\\ndata: {"log":"two"}\\n\\ndata: {"closed":true}\\n\\n']) c.enqueue(enc.encode(chunk)); c.close(); }}), {headers:{'content-type':'text/event-stream'}});`
  )
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { logs: ['one', 'two'] })
  assert.equal(result.stderr, '')
})
test('CLI logs rejects invalid tails, incompatible output modes, and truncated streams', async () => {
  for (const extra of [['--tail=-1'], ['--follow'], ['--ndjson']]) {
    const result = await execute(
      ['logs', '--project', 'harbor', '--json', ...extra],
      `throw new Error('Should not fetch');`
    )
    assert.equal(result.code, 1)
    assert.ok(!result.stderr.includes('Should not fetch'))
    assert.equal(JSON.parse(result.stderr).type, 'error')
  }
  const truncated = await execute(
    ['logs', '--project', 'harbor', '--json'],
    response('data: {"log":"one"}\n\n', 'text/event-stream')
  )
  assert.equal(truncated.code, 1)
  assert.match(JSON.parse(truncated.stderr).error.message, /unexpectedly/)
})

test('CLI run accepts stdin without exposing input in JSON and usage parse errors stay machine readable', async () => {
  const result = await execute(
    ['run', '--project', 'harbor', '--env', 'staging', '--stdin', '--json'],
    `assert.equal(JSON.parse(options.body).code,'node --version'); ${response(
      '{"type":"result","result":{"success":true,"exitCode":0}}\n'
    )}`,
    `const {Readable}=await import('node:stream'); Object.defineProperty(process,'stdin',{value:Readable.from([Buffer.from('node --version')])})`
  )
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).result.success, true)
  assert.ok(!result.stdout.includes('node --version'))
  const invalid = await execute(
    ['logs', '--tail', '-1', '--json'],
    `throw new Error('Should not fetch')`
  )
  assert.equal(invalid.code, 1)
  assert.equal(JSON.parse(invalid.stderr).type, 'error')
})
