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
    transport: fixture.transport,
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

test('live command fixtures enumerate only registered processes while retaining real supervisor and child identities', async () =>
  withFixture(async (fixture) => {
    const result = await run(fixture, [
      'node',
      '-e',
      `console.log(JSON.stringify({pid:process.pid,parent:process.ppid,pids:require('fs').readdirSync('/proc')}))`
    ])
    assert.equal(result.status, 'success', terminalDiagnostic(result))
    const view = JSON.parse(result.stdout)
    assert.ok(
      view.pids.includes(String(view.pid)),
      'The real command is registered before user code'
    )
    assert.ok(
      view.pids.includes(String(view.parent)),
      'The real guardian remains visible'
    )
    assert.ok(
      view.pids.includes(String(fixture.app.pid)),
      'The resident app remains visible'
    )
    assert.equal(
      view.pids.includes(String(process.pid)),
      false,
      'Unrelated host processes are outside this controlled fixture inventory'
    )
    const registered = await fs.readdir(
      path.join(fixture.root, 'process-inventory')
    )
    assert.ok(registered.includes(String(view.pid)))
    assert.ok(registered.includes(String(view.parent)))
    assert.ok(
      registered.length >= 4,
      'App, supervisor, guardian and command must all register'
    )
    // This check uses the parent test process's unmodified real procfs access.
    assert.equal(await alive(view.pid), false)
    assert.equal(await alive(fixture.app.pid), true)
  }))

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
    assert.equal(result.status, 'success', terminalDiagnostic(result))
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
    assert.equal(failed.status, 'error', terminalDiagnostic(failed))
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
    assert.equal(missing.status, 'error', terminalDiagnostic(missing))
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
    assert.equal(result.status, 'success', terminalDiagnostic(result))
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
    assert.equal(escaped.status, 'success', terminalDiagnostic(escaped))
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
    assert.equal(result.status, 'cancelled', terminalDiagnostic(result))
    assert.equal(result.terminationConfirmed, true)
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' })
  }))

test('command cancellation kills only its owned foreground process group and descendants', async () =>
  withFixture(async (fixture) => {
    const controller = new AbortController()
    let descendant
    let output = ''
    // Do not race cancellation against the child's Node startup. Its ready
    // message proves the real TERM handler (and inventory preload) is installed.
    const childCode =
      'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)'
    const code = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(
      childCode
    )}],{stdio:['ignore','pipe','ignore']});process.on('SIGTERM',()=>{});c.stdout.once('data',()=>console.log(c.pid));setInterval(()=>{},1000)`
    const result = await run(fixture, ['node', '-e', code], {
      signal: controller.signal,
      onEvent(event) {
        if (event.type === 'stdout' && !descendant) {
          output += event.text
          const newline = output.indexOf('\n')
          if (newline !== -1) {
            descendant = Number(output.slice(0, newline))
            controller.abort()
          }
        }
      }
    })
    assert.equal(result.status, 'cancelled', terminalDiagnostic(result))
    assert.equal(result.terminationConfirmed, true)
    assert.equal(result.signal, 'SIGKILL')
    assert.ok(descendant)
    assert.match(
      await fs.readFile(
        path.join(fixture.root, 'process-inventory', String(descendant)),
        'utf8'
      ),
      /^\d+$/
    )
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
    assert.equal(timed.status, 'timeout', terminalDiagnostic(timed))
    assert.equal(timed.terminationConfirmed, true)
    const orphan = await run(fixture, [
      'node',
      '-e',
      'const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log(c.pid);c.unref();process.exit(0)'
    ])
    assert.equal(orphan.status, 'success', terminalDiagnostic(orphan))
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
    assert.equal(wrong.status, 'error', terminalDiagnostic(wrong))
    assert.equal(wrong.error.code, 'HELM_APP_CONTEXT_UNAVAILABLE')
    await fs.writeFile(
      fixture.contractPath,
      JSON.stringify({ ...fixture.contract, startTicks: '0' })
    )
    const stale = await run(fixture, argv)
    assert.equal(stale.status, 'error', terminalDiagnostic(stale))
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
      assert.equal(escaped.status, 'unconfirmed', terminalDiagnostic(escaped))
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
    assert.equal(
      disconnected.status,
      'unconfirmed',
      terminalDiagnostic(disconnected)
    )
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
    assert.equal(result.status, 'cancelled', terminalDiagnostic(result))
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
      assert.equal(result.status, 'success', terminalDiagnostic(result))
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

test('serialized Docker ownership probes distinguish live/terminated fixtures and fail closed on unreadable new PIDs', () => {
  const probes = require('../../../support/helm-command-probes')
  const proc = syntheticProc()
  const executionId = 'controlled-probe-fixture'
  const { baseline } = runtime.createOwnershipTracker({
    fs: proc.fs,
    ownPid: 99,
    executionId
  })
  const check = () =>
    runControlledProbe(
      probes.assertNoOwnedProcesses,
      [executionId, baseline],
      proc.fs
    )
  proc.processes.set('2', {
    ticks: '202',
    group: 2,
    state: 'S',
    env: `SLIPWAY_HELM_EXECUTION_ID=${executionId}\0`
  })
  assert.equal(
    check(),
    1,
    'A live tagged fixture must fail the ownership assertion'
  )
  assert.equal(runControlledProbe(probes.assertStopped, [2], proc.fs), 1)
  proc.processes.get('2').state = 'Z'
  assert.equal(check(), 0, 'A zombie is already terminated')
  assert.equal(runControlledProbe(probes.assertStopped, [2], proc.fs), 0)
  proc.processes.delete('2')
  assert.equal(
    check(),
    0,
    'A removed fixture must pass the ownership assertion'
  )
  assert.equal(runControlledProbe(probes.assertStopped, [2], proc.fs), 0)
  // Model the hosted-runner failure without relying on unrelated processes
  // appearing (or not appearing) in the host's real /proc during this unit test.
  proc.processes.set('3', { ticks: '203', group: 3, state: 'S', denied: true })
  assert.throws(check, { code: 'EACCES' })
  proc.processes.delete('3')
  proc.processes.get('1').ticks = '204'
  assert.throws(
    check,
    { code: 'EACCES' },
    'PID reuse must invalidate the pre-existing process shortcut'
  )
  assert.doesNotThrow(
    () =>
      new (require('node:vm').Script)(
        `(${probes.spawnDescendant.toString()})()`
      )
  )
})

// Exercise the exact serialized probe used by Docker while replacing only its
// procfs inventory and process.exit. No production permission rule is changed.
function runControlledProbe(probe, args, filesystem) {
  const { Script } = require('node:vm')
  const script = new Script(`(${probe.toString()})(...${JSON.stringify(args)})`)
  try {
    script.runInNewContext(
      {
        require(name) {
          assert.equal(name, 'node:fs')
          return filesystem
        },
        process: {
          exit(status) {
            const error = new Error('Controlled probe exit')
            error.probeExitStatus = status
            throw error
          }
        }
      },
      { timeout: 1000 }
    )
    return 0
  } catch (error) {
    if (Number.isInteger(error.probeExitStatus)) return error.probeExitStatus
    throw error
  }
}

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
      stdio: ['pipe', 'pipe', 'pipe'],
      env: fixture.transport.env
    })
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let terminal
    let ownedPid
    let childOutput = ''
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
                  argv: [
                    'node',
                    '-e',
                    'console.log(process.pid);setInterval(()=>{},1000)'
                  ]
                }) + '\n'
              )
            if (packet.type === 'stdout' && !ownedPid) {
              childOutput += packet.text
              const newline = childOutput.indexOf('\n')
              if (newline !== -1) {
                ownedPid = Number(childOutput.slice(0, newline))
                client.stdin.end()
              }
            }
            if (packet.type === 'result') terminal = packet.result
          }
        })
      })
      assert.equal(terminal.status, 'cancelled', terminalDiagnostic(terminal))
      assert.equal(terminal.terminationConfirmed, true)
      assert.equal(terminal.terminationScope, 'foreground-process-group')
      assert.ok(Number.isSafeInteger(ownedPid) && ownedPid > 1)
      const stopped = spawnSync(process.execPath, [
        '-e',
        `(${probes.assertStopped.toString()})(${ownedPid})`
      ])
      assert.equal(stopped.status, 0, String(stopped.stderr || '').slice(-4096))
    } finally {
      clearTimeout(timer)
      if (client.exitCode === null && client.signalCode === null)
        client.kill('SIGKILL')
    }
  }))

function terminalDiagnostic(result) {
  return JSON.stringify({
    status: result?.status,
    error: result?.error,
    exitCode: result?.exitCode,
    signal: result?.signal,
    terminationDiagnostic: result?.terminationDiagnostic
  }).slice(0, 4096)
}

// /proc exposes identity to ordinary users while protecting other processes'
// environ. Model that permission split without changing users or OS settings.
function syntheticProc() {
  const processes = new Map([
    ['1', { ticks: '100', group: 1, state: 'S', denied: true }],
    ['99', { ticks: '200', group: 99, state: 'S', env: '' }]
  ])
  const reads = []
  const filesystem = {
    readdirSync() {
      return [...processes.keys()]
    },
    readFileSync(filename) {
      reads.push(filename)
      const [, pid, kind] =
        filename.match(/^\/proc\/(\d+)\/(stat|environ)$/) || []
      const value = processes.get(pid)
      if (!value) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      if (kind === 'stat') {
        const fields = Array(20).fill('0')
        fields[0] = value.state
        fields[1] = '1'
        fields[2] = String(value.group)
        fields[19] = value.ticks
        return `${pid} (synthetic process) ${fields.join(' ')}`
      }
      if (value.denied)
        throw Object.assign(new Error('protected environment'), {
          code: 'EACCES'
        })
      return value.env || ''
    }
  }
  return { processes, reads, fs: filesystem }
}

test('cleanup excludes unreadable environments only for unchanged pre-execution process identities', () => {
  const proc = syntheticProc()
  const tracker = runtime.createOwnershipTracker({
    fs: proc.fs,
    ownPid: 99,
    executionId: 'fixture'
  })
  assert.equal(tracker.hasSurvivors(500), false)
  assert.equal(
    proc.reads.some((name) => name.endsWith('/environ')),
    false
  )
  // Known group membership always wins over the prior-process shortcut.
  proc.processes.get('1').group = 500
  assert.equal(tracker.hasSurvivors(500), true)
})

test('cleanup fails closed for unreadable new/reused PID ownership, with bounded diagnostic context', () => {
  const proc = syntheticProc()
  const tracker = runtime.createOwnershipTracker({
    fs: proc.fs,
    ownPid: 99,
    executionId: 'fixture'
  })
  const expectUnreadable = (pid) =>
    assert.throws(
      () => tracker.hasSurvivors(500),
      (error) => {
        assert.equal(error.code, 'EACCES')
        assert.deepEqual(error.ownershipDiagnostic, {
          stage: 'read-environment',
          code: 'EACCES',
          pid
        })
        return true
      }
    )
  proc.processes.set('2', { ticks: '202', group: 2, state: 'S', denied: true })
  expectUnreadable(2)
  proc.processes.delete('2')
  // The same PID with a new start tick is NOT the original pre-existing process.
  proc.processes.get('1').ticks = '203'
  expectUnreadable(1)
  proc.processes.get('1').state = 'Z'
  assert.equal(tracker.hasSurvivors(500), false)
})

test('cleanup still detects tagged detached descendants despite unrelated protected processes', () => {
  const proc = syntheticProc()
  const tracker = runtime.createOwnershipTracker({
    fs: proc.fs,
    ownPid: 99,
    executionId: 'fixture'
  })
  proc.processes.set('2', {
    ticks: '202',
    group: 2,
    state: 'S',
    env: 'SLIPWAY_HELM_EXECUTION_ID=fixture\0'
  })
  assert.equal(tracker.hasSurvivors(500), true)
  proc.processes.delete('2')
  assert.equal(tracker.hasSurvivors(500), false)
})

test('fixture PID publication is atomic under concurrent preload registration and rejects corrupt identities', async () => {
  const { runInNewContext } = require('node:vm')
  const source = await fs.readFile(
    require.resolve('../../../support/helm-command-process-inventory.cjs'),
    'utf8'
  )
  const files = new Map([['/inventory/200', '2000']])
  let observeWrites = false
  let failWrite = false
  let sequence = 0
  const duringWrites = []
  const missing = () =>
    Object.assign(new Error('Missing fixture file'), { code: 'ENOENT' })
  const fakeFs = {
    readdirSync(directory) {
      if (directory === '/proc') return ['100', '200']
      if (directory === '/inventory')
        return [...files.keys()].map((name) => path.basename(name))
      throw missing()
    },
    readFileSync(filename) {
      const processStat = filename.match(/^\/proc\/(100|200)\/stat$/)
      if (processStat) {
        const pid = processStat[1]
        const fields = Array(20).fill('0')
        fields[0] = 'S'
        fields[2] = pid
        fields[19] = `${pid}0`
        return `${pid} (registered fixture) ${fields.join(' ')}`
      }
      if (!files.has(filename)) throw missing()
      return files.get(filename)
    },
    writeFileSync(filename, value) {
      // Model the intermediate truncate state that caused the original race.
      files.set(filename, '')
      if (observeWrites) {
        duringWrites.push(fakeFs.readdirSync('/proc'))
        for (const [name, contents] of files) {
          if (/^\d+$/.test(path.basename(name))) assert.match(contents, /^\d+$/)
        }
      }
      if (failWrite)
        throw Object.assign(new Error('Fixture write failure'), { code: 'EIO' })
      files.set(filename, value)
    },
    renameSync(from, to) {
      if (!files.has(from)) throw missing()
      files.set(to, files.get(from))
      files.delete(from)
    },
    unlinkSync(filename) {
      if (!files.delete(filename)) throw missing()
    }
  }
  const childProcess = {
    spawn() {
      return { pid: 200 }
    }
  }
  runInNewContext(source, {
    require(name) {
      if (name === 'node:fs') return fakeFs
      if (name === 'node:path') return path
      if (name === 'node:child_process') return childProcess
      if (name === 'node:crypto')
        return { randomUUID: () => `unique-${++sequence}` }
      throw new Error(`Unexpected preload dependency: ${name}`)
    },
    process: {
      pid: 100,
      env: { SLIPWAY_HELM_TEST_PROCESS_INVENTORY: '/inventory' }
    }
  })
  observeWrites = true
  childProcess.spawn()
  assert.deepEqual(
    duringWrites,
    [['100', '200']],
    'A live PID remains visible during a concurrent registration write'
  )
  assert.equal(
    [...files.keys()].some((name) => name.endsWith('.tmp')),
    false
  )

  for (const corrupt of ['', 'not-a-start-tick', '2000\n']) {
    files.set('/inventory/200', corrupt)
    assert.throws(() => fakeFs.readdirSync('/proc'), {
      code: 'HELM_FIXTURE_IDENTITY_INVALID'
    })
  }
  files.set('/inventory/200', '999')
  assert.deepEqual(
    fakeFs.readdirSync('/proc'),
    ['100'],
    'A valid different start tick identifies a reused PID'
  )
  files.set('/inventory/200', '2000')
  failWrite = true
  assert.throws(() => childProcess.spawn(), { code: 'EIO' })
  assert.equal(
    files.get('/inventory/200'),
    '2000',
    'A failed publication preserves the last complete identity'
  )
  assert.equal(
    [...files.keys()].some((name) => name.endsWith('.tmp')),
    false,
    'Failed publication removes its private temporary file'
  )
})
