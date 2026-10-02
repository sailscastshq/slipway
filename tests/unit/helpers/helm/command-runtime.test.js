const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const runtime = require('../../../../api/lib/helm-command-runtime')
const commandFixture = require('../../../support/helm-command-fixture')

async function withFixture(fn) {
  const fixture = await commandFixture()
  try {
    await fn(fixture)
  } finally {
    await fixture.close()
  }
}
function run(fixture, argv, options = {}) {
  return runtime.executeCommand({
    argv,
    expectedRuntime: fixture.expectedRuntime,
    executionId: randomUUID(),
    transport: { command: process.execPath },
    timeoutMs: 5000,
    killGraceMs: 60,
    processGraceMs: 1000,
    maxOutputBytes: 8192,
    ...options
  })
}
async function alive(pid) {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8')
    return !['Z', 'X'].includes(
      stat
        .slice(stat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)[0]
    )
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

test('command runtime streams literal argv, deployed environment and cwd without a shell', async () =>
  withFixture(async (fixture) => {
    const events = []
    const result = await run(
      fixture,
      [
        'node',
        '-e',
        'console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),value:process.env.HELM_COMMAND_FIXTURE,stdin:process.stdin.isTTY||false}));console.error("stderr-value")',
        'semi;$(not-a-shell)',
        'two words'
      ],
      { onEvent: (event) => events.push(event) }
    )
    assert.equal(result.status, 'success')
    assert.equal(result.exitCode, 0)
    assert.equal(result.signal, null)
    assert.equal(result.terminationConfirmed, true)
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ['semi;$(not-a-shell)', 'two words'],
      cwd: fixture.root,
      value: 'deployed-fixture-value',
      stdin: false
    })
    assert.equal(result.stderr, 'stderr-value\n')
    assert.equal(events[0].type, 'started')
    assert.equal(
      events
        .filter((event) => event.type === 'stdout')
        .map((event) => event.text)
        .join(''),
      result.stdout
    )
  }))

test('command runtime returns native nonzero exit and signal, and handles spawn failure', async () =>
  withFixture(async (fixture) => {
    const failed = await run(fixture, ['node', '-e', 'process.exit(23)'])
    assert.equal(failed.status, 'error')
    assert.equal(failed.exitCode, 23)
    const signalled = await run(fixture, [
      'node',
      '-e',
      'process.kill(process.pid,"SIGTERM")'
    ])
    assert.equal(signalled.exitCode, null)
    assert.equal(signalled.signal, 'SIGTERM')
    const missing = await run(fixture, [
      '/definitely-not-installed-slipway-command'
    ])
    assert.equal(missing.status, 'error')
    assert.equal(missing.error.code, 'HELM_COMMAND_SPAWN')
    assert.equal(missing.terminationConfirmed, true)
  }))

test('command runtime bounds noisy output and preserves split multibyte characters', async () =>
  withFixture(async (fixture) => {
    const result = await run(
      fixture,
      [
        'node',
        '-e',
        'const b=Buffer.from("🐚é");process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));process.stdout.write("🌊".repeat(20000));process.stderr.write("x".repeat(100000))},5)'
      ],
      { maxOutputBytes: 101 }
    )
    assert.equal(result.status, 'success')
    assert.equal(result.truncated, true)
    assert.ok(result.stdout.startsWith('🐚é'))
    assert.ok(!result.stdout.includes('�'))
    assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= 101)
    assert.equal(
      result.outputBytes,
      Buffer.byteLength(result.stdout + result.stderr)
    )
    const escaped = await run(fixture, [
      'node',
      '-e',
      'process.stdout.write("\\0".repeat(20000))'
    ])
    assert.equal(escaped.status, 'success')
    assert.equal(escaped.outputBytes, 8192)
  }))

test('command abort before start cannot spawn the command', async () =>
  withFixture(async (fixture) => {
    const controller = new AbortController()
    controller.abort()
    const marker = path.join(fixture.root, 'not-created')
    const result = await run(
      fixture,
      [
        'node',
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(marker)},'no')`
      ],
      { signal: controller.signal }
    )
    assert.equal(result.status, 'cancelled')
    assert.equal(result.terminationConfirmed, true)
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' })
  }))

test('command cancellation kills only its owned foreground process group and descendants', async () =>
  withFixture(async (fixture) => {
    const controller = new AbortController()
    let descendant
    const code = `const c=require('child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});process.on('SIGTERM',()=>{});console.log(c.pid);setInterval(()=>{},1000)`
    const result = await run(fixture, ['node', '-e', code], {
      signal: controller.signal,
      onEvent(event) {
        if (event.type === 'stdout') {
          descendant = Number(event.text.trim())
          controller.abort()
        }
      }
    })
    assert.equal(result.status, 'cancelled')
    assert.equal(result.terminationConfirmed, true)
    assert.equal(result.signal, 'SIGKILL')
    assert.ok(descendant)
    assert.equal(await alive(descendant), false)
    assert.equal(await alive(fixture.app.pid), true)
  }))

test('command timeout reaps foreground orphans even after the immediate command exits', async () =>
  withFixture(async (fixture) => {
    const timed = await run(
      fixture,
      ['node', '-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
      { timeoutMs: 150 }
    )
    assert.equal(timed.status, 'timeout')
    assert.equal(timed.terminationConfirmed, true)
    const orphan = await run(fixture, [
      'node',
      '-e',
      'const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log(c.pid);c.unref();process.exit(0)'
    ])
    assert.equal(orphan.status, 'success')
    assert.equal(await alive(Number(orphan.stdout.trim())), false)
  }))

test('command runtime refuses stale PID identity and mismatched deployment before spawning', async () =>
  withFixture(async (fixture) => {
    const marker = path.join(fixture.root, 'wrong-app')
    const argv = [
      'node',
      '-e',
      `require('fs').writeFileSync(${JSON.stringify(marker)},'wrong')`
    ]
    const wrong = await run(fixture, argv, {
      expectedRuntime: { ...fixture.expectedRuntime, deploymentId: '2' }
    })
    assert.equal(wrong.status, 'error')
    assert.equal(wrong.error.code, 'HELM_APP_CONTEXT_UNAVAILABLE')
    await fs.writeFile(
      fixture.contractPath,
      JSON.stringify({ ...fixture.contract, startTicks: '0' })
    )
    const stale = await run(fixture, argv)
    assert.equal(stale.status, 'error')
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' })
  }))

test('command detached descendants and missing terminal transport evidence stay unconfirmed', async () =>
  withFixture(async (fixture) => {
    let escapedPid
    try {
      const escaped = await run(fixture, [
        'node',
        '-e',
        'const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});console.log(c.pid);c.unref();process.exit(0)'
      ])
      escapedPid = Number(escaped.stdout.trim())
      assert.equal(escaped.status, 'unconfirmed')
      assert.equal(escaped.terminationConfirmed, false)
      assert.equal(await alive(escapedPid), true)
    } finally {
      if (escapedPid) {
        try {
          process.kill(escapedPid, 'SIGKILL')
        } catch {}
      }
    }
    const disconnected = await run(fixture, ['node', '-e', '0'], {
      transport: {
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({version:1,type:"ready"})+"\\n");process.stdin.once("data",()=>process.exit(0))'
        ]
      }
    })
    assert.equal(disconnected.status, 'unconfirmed')
    assert.equal(disconnected.terminationConfirmed, false)
  }))

test('command abort while transport prepares does not race a late command spawn', async () =>
  withFixture(async (fixture) => {
    const controller = new AbortController()
    const marker = path.join(fixture.root, 'late-spawn')
    const pending = run(
      fixture,
      [
        'node',
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`
      ],
      { signal: controller.signal }
    )
    controller.abort()
    const result = await pending
    assert.equal(result.status, 'cancelled')
    assert.equal(result.terminationConfirmed, true)
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' })
  }))

test('command exit wins a later cancel during process-group cleanup', async () =>
  withFixture(async (fixture) => {
    const controller = new AbortController()
    let timer
    try {
      const result = await run(
        fixture,
        ['node', '-e', 'console.log("done");process.exit(0)'],
        {
          signal: controller.signal,
          killGraceMs: 200,
          onEvent(event) {
            if (event.type === 'stdout')
              timer = setTimeout(() => controller.abort(), 70)
          }
        }
      )
      assert.equal(result.status, 'success')
      assert.equal(result.exitCode, 0)
      assert.equal(result.terminationConfirmed, true)
    } finally {
      clearTimeout(timer)
    }
  }))

test('command identity opt-in rejects broader exec groups and preserves legacy resolver shape', async () =>
  withFixture(async (fixture) => {
    const resolveContext = require('../../../../api/lib/helm-app-context')
    const realFs = require('node:fs')
    const ordinary = resolveContext({
      expectedRuntime: fixture.expectedRuntime
    })
    assert.equal(ordinary.processIdentity, undefined)
    const verified = resolveContext({
      expectedRuntime: fixture.expectedRuntime,
      includeProcessIdentity: true
    })
    assert.ok(verified.processIdentity.Uid)
    const fakeFs = {
      ...realFs,
      readFileSync(filename, ...args) {
        const value = realFs.readFileSync(filename, ...args)
        if (filename === `/proc/${process.pid}/status`)
          return value.replace(/^Groups:(.*)$/m, 'Groups:$1 999999')
        return value
      }
    }
    assert.throws(
      () =>
        resolveContext({
          fs: fakeFs,
          expectedRuntime: fixture.expectedRuntime,
          includeProcessIdentity: true
        }),
      { code: 'HELM_PROCESS_IDENTITY_MISMATCH' }
    )
  }))

test('Docker contract ownership probes distinguish running children from terminated ones', async () =>
  withFixture(async (fixture) => {
    const probes = require('../../../support/helm-command-probes')
    const { spawn, spawnSync } = require('node:child_process')
    const executionId = randomUUID()
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: 'ignore',
      env: { ...process.env, SLIPWAY_HELM_EXECUTION_ID: executionId }
    })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    const check = () =>
      spawnSync(process.execPath, [
        '-e',
        `(${probes.assertNoOwnedProcesses.toString()})(${JSON.stringify(
          executionId
        )})`
      ])
    try {
      assert.equal(
        check().status,
        1,
        'Live execution marker must fail the ownership assertion'
      )
      assert.equal(
        spawnSync(process.execPath, [
          '-e',
          `(${probes.assertStopped.toString()})(${fixture.app.pid})`
        ]).status,
        1
      )
    } finally {
      const closed = new Promise((resolve) => child.once('close', resolve))
      child.kill('SIGKILL')
      await closed
    }
    assert.equal(check().status, 0)
    assert.equal(
      spawnSync(process.execPath, [
        '-e',
        `(${probes.assertStopped.toString()})(${child.pid})`
      ]).status,
      0
    )
    assert.doesNotThrow(
      () =>
        new (require('node:vm').Script)(
          `(${probes.spawnDescendant.toString()})()`
        )
    )
  }))

test('command identity comparison preserves real/effective UID field positions', async () =>
  withFixture(async (fixture) => {
    const resolveContext = require('../../../../api/lib/helm-app-context')
    const realFs = require('node:fs')
    const fakeFs = {
      ...realFs,
      readFileSync(filename, ...args) {
        const value = realFs.readFileSync(filename, ...args)
        if (filename === `/proc/${fixture.app.pid}/status`)
          return value.replace(/^Uid:.*$/m, 'Uid:\t1000\t0\t1000\t0')
        if (filename === `/proc/${process.pid}/status`)
          return value.replace(/^Uid:.*$/m, 'Uid:\t0\t1000\t0\t1000')
        return value
      }
    }
    assert.throws(
      () =>
        resolveContext({
          fs: fakeFs,
          expectedRuntime: fixture.expectedRuntime,
          includeProcessIdentity: true
        }),
      { code: 'HELM_PROCESS_IDENTITY_MISMATCH' }
    )
  }))

test('command supervisor cancels on control EOF and confirms cleanup independently of host abort', async () =>
  withFixture(async (fixture) => {
    const { spawn, spawnSync } = require('node:child_process')
    const { StringDecoder } = require('node:string_decoder')
    const probes = require('../../../support/helm-command-probes')
    const executionId = randomUUID()
    const source = runtime.buildRunnerSource({
      expectedRuntime: fixture.expectedRuntime,
      executionId,
      timeoutMs: 2000,
      killGraceMs: 60,
      maxOutputBytes: 8192
    })
    const client = spawn(process.execPath, ['-e', source], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let terminal
    let timer
    client.stdin.on('error', () => {})
    client.stderr.resume()
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Supervisor EOF test did not finish')),
          7000
        )
        client.once('error', reject)
        client.once('close', resolve)
        client.stdout.on('data', (chunk) => {
          pending += decoder.write(chunk)
          let newline
          while ((newline = pending.indexOf('\n')) >= 0) {
            const packet = JSON.parse(pending.slice(0, newline))
            pending = pending.slice(newline + 1)
            if (packet.type === 'ready')
              client.stdin.write(
                JSON.stringify({
                  type: 'start',
                  argv: ['node', '-e', 'setInterval(()=>{},1000)']
                }) + '\n'
              )
            if (packet.type === 'started') client.stdin.end()
            if (packet.type === 'result') terminal = packet.result
          }
        })
      })
      assert.equal(terminal.status, 'cancelled')
      assert.equal(terminal.terminationConfirmed, true)
      assert.equal(terminal.terminationScope, 'foreground-process-group')
      assert.equal(
        spawnSync(process.execPath, [
          '-e',
          `(${probes.assertNoOwnedProcesses.toString()})(${JSON.stringify(
            executionId
          )})`
        ]).status,
        0
      )
    } finally {
      clearTimeout(timer)
      if (client.exitCode === null && client.signalCode === null)
        client.kill('SIGKILL')
    }
  }))
