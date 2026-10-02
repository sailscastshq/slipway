const { test } = require('sounding')
const assert = require('node:assert/strict')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { StringDecoder } = require('node:string_decoder')
const runtime = require('../../api/lib/helm-command-runtime')
const probes = require('../support/helm-command-probes')
const run = promisify(execFile)

test('disposable Docker command contract verifies app identity, Sails CLI, cancellation and client disconnect', async () => {
  const docker = process.env.SLIPWAY_DOCKER_BINARY || 'docker'
  const image =
    process.env.SLIPWAY_HELM_COMMAND_IMAGE || 'node:22-bookworm-slim'
  const name = `slipway-helm-command-test-${randomUUID()}`
  const expectedRuntime = { appId: '592', deploymentId: '1', required: true }
  const command = (args) =>
    run(docker, args, { timeout: 30000, maxBuffer: 1024 * 1024 })
  let created = false
  try {
    // CI must provision this image explicitly; this test never downloads tools.
    await command(['image', 'inspect', image])
    await command([
      'run',
      '-d',
      '--init',
      '--name',
      name,
      '--network',
      'none',
      '--memory',
      '256m',
      '--tmpfs',
      '/app:rw,size=16m',
      '--tmpfs',
      '/tmp:rw,size=32m',
      '-v',
      `${path.resolve('.')}:/host:ro`,
      '-v',
      `${await fs.realpath('node_modules')}:/fixture/node_modules:ro`,
      // Preserve both Node's hoisted sibling lookup (the directory must be
      // named node_modules) and npm workspace links relative to that directory.
      // /deps would resolve sails itself but lose @sailshq/lodash and peers.
      '-v',
      `${path.resolve('packages')}:/fixture/packages:ro`,
      '-v',
      `${path.resolve('assets')}:/fixture/assets:ro`,
      '-w',
      '/app',
      '-e',
      'NODE_ENV=staging',
      '-e',
      'SLIPWAY_APP_ID=592',
      '-e',
      'SLIPWAY_DEPLOYMENT_ID=1',
      image,
      'node',
      '/host/tests/fixtures/helm-command/container.cjs'
    ])
    created = true
    let ready = false
    let readinessError
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await command([
          'exec',
          name,
          'node',
          '-e',
          'require("fs").accessSync("/tmp/helm-command-ready")'
        ])
        ready = true
        break
      } catch (error) {
        readinessError = error
        // An exited/OOM-killed fixture cannot become ready. Report its bounded
        // diagnostics immediately rather than hiding the cause behind a retry.
        const state = await command([
          'inspect',
          '--format',
          '{{.State.Running}}',
          name
        ])
        if (state.stdout.trim() !== 'true') break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    assert.ok(
      ready,
      `The disposable app publishes a runtime contract. Last readiness error: ${boundedDiagnostic(
        readinessError?.stderr || readinessError?.message || 'none'
      )}`
    )
    const execute = (argv, options = {}) =>
      runtime.executeCommand({
        containerName: name,
        dockerPath: docker,
        argv,
        expectedRuntime,
        executionId: randomUUID(),
        timeoutMs: 10000,
        killGraceMs: 100,
        processGraceMs: 2000,
        ...options
      })
    const events = []
    const sailsResult = await execute(
      ['sails', 'run', 'probe', '--handle=two words'],
      { onEvent: (event) => events.push(event) }
    )
    assert.equal(sailsResult.status, 'success', sailsResult.stderr)
    assert.equal(sailsResult.exitCode, 0)
    assert.ok(sailsResult.stdout.includes('"handle":"two words"'))
    assert.ok(sailsResult.stdout.includes('"environment":"staging"'))
    assert.ok(sailsResult.stdout.includes('"migrate":"safe"'))
    assert.ok(sailsResult.stdout.includes('"autoStart":false'))
    assert.ok(
      events.some(
        (event) =>
          event.type === 'stderr' && event.text.includes('fixture-stderr')
      )
    )
    const wrong = await execute(['node', '-e', 'console.log("WRONG_APP")'], {
      expectedRuntime: { ...expectedRuntime, deploymentId: '2' }
    })
    assert.equal(wrong.status, 'error')
    assert.equal(wrong.stdout, '')
    const invalid = await execute(['sails', 'run', 'probe'])
    assert.equal(invalid.status, 'error')
    assert.equal(invalid.exitCode, 1)
    const aborted = new AbortController()
    let descendant
    const stopped = await execute(
      ['node', '-e', `(${probes.spawnDescendant.toString()})()`],
      {
        signal: aborted.signal,
        onEvent(event) {
          if (event.type === 'stdout') {
            descendant = Number(event.text.trim())
            aborted.abort()
          }
        }
      }
    )
    assert.equal(stopped.status, 'cancelled')
    assert.equal(stopped.terminationConfirmed, true)
    await command([
      'exec',
      name,
      'node',
      '-e',
      `(${probes.assertStopped.toString()})(${JSON.stringify(descendant)})`
    ])

    // Kill only the Docker CLIENT, then verify the independent in-container
    // deadline really removes the process. A client close alone proves nothing.
    const executionId = randomUUID()
    const source = runtime.buildRunnerSource({
      executionId,
      expectedRuntime,
      timeoutMs: 1200,
      killGraceMs: 100,
      maxOutputBytes: 8192
    })
    const client = spawn(docker, ['exec', '-i', name, 'node', '-e', source], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    client.stdin.on('error', () => {})
    client.stderr.resume()
    const decoder = new StringDecoder('utf8')
    let pending = ''
    const started = new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error('Disconnected fixture did not start')),
        10000
      )
      client.once('error', reject)
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
                  'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'
                ]
              }) + '\n'
            )
          if (packet.type === 'started') {
            clearTimeout(deadline)
            resolve()
          }
        }
      })
    })
    await started
    const closed = new Promise((resolve) => client.once('close', resolve))
    client.kill('SIGKILL')
    await closed
    await new Promise((resolve) => setTimeout(resolve, 1700))
    const ownershipCheck = `(${probes.assertNoOwnedProcesses.toString()})(${JSON.stringify(
      executionId
    )})`
    await command(['exec', name, 'node', '-e', ownershipCheck])
  } catch (error) {
    if (created) {
      // Only this isolated test container is inspected. Bound both the Docker
      // client capture and the printed tail, and gather evidence before rm -f.
      for (const [label, args] of [
        ['container state', ['inspect', '--format', '{{json .State}}', name]],
        ['fixture logs', ['logs', '--tail', '80', name]]
      ]) {
        try {
          const result = await run(docker, args, {
            timeout: 5000,
            maxBuffer: 128 * 1024
          })
          console.error(
            `[Helm command contract ${label}]\n${boundedDiagnostic(
              result.stdout + result.stderr
            )}`
          )
        } catch (diagnosticError) {
          console.error(
            `[Helm command contract ${label}] ${boundedDiagnostic(
              diagnosticError.stdout ||
                diagnosticError.stderr ||
                diagnosticError.message
            )}`
          )
        }
      }
    }
    throw error
  } finally {
    if (created) await command(['rm', '-f', name])
  }
})

function boundedDiagnostic(value) {
  return String(value || '').slice(-16 * 1024)
}
