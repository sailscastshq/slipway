const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { StringDecoder } = require('node:string_decoder')
const resolveAppContext = require('./helm-app-context')

const PROTOCOL_VERSION = 1

/**
 * A command transport is not the command. Only the in-container supervisor can
 * confirm termination. In particular, killing a docker client proves nothing
 * about an exec process which may already have started on the Docker daemon.
 */
async function executeCommand({
  containerName,
  argv,
  executionId = randomUUID(),
  expectedRuntime,
  signal,
  onEvent,
  dockerPath = 'docker',
  timeoutMs = 30000,
  killGraceMs = 1000,
  processGraceMs = 5000,
  maxOutputBytes = 64 * 1024,
  // Private transport injection keeps the same real runner in synthetic tests.
  transport
}) {
  const startedAt = Date.now()
  validateOptions({ argv, executionId, timeoutMs, killGraceMs, maxOutputBytes })
  if (signal?.aborted) return failure('cancelled', 'HELM_CANCELLED', false)
  const source = buildRunnerSource({
    executionId,
    expectedRuntime,
    timeoutMs,
    killGraceMs,
    maxOutputBytes
  })
  let client
  let startGranted = false
  let settled = false
  let cancellation
  let terminal
  let timer
  let stopTimer
  let line = ''
  const decoder = new StringDecoder('utf8')
  let outputBytes = 0
  let stdout = ''
  let stderr = ''
  let output = ''
  let truncated = false
  const deadline = timeoutMs + killGraceMs + processGraceMs

  return new Promise((resolve) => {
    function finish(result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(stopTimer)
      signal?.removeEventListener('abort', abort)
      client?.stdin?.destroy()
      // The remote terminal envelope is the evidence; terminating a stuck
      // transport after that envelope does not alter its result.
      if (client && client.exitCode === null && client.signalCode === null) {
        client.kill('SIGKILL')
      }
      resolve({
        stdout,
        stderr,
        output,
        outputBytes,
        truncated,
        ...result,
        durationMs: Date.now() - startedAt
      })
    }
    function uncertain(message) {
      finish(
        failure(
          startGranted ? 'unconfirmed' : cancellation || 'error',
          startGranted ? 'HELM_COMMAND_UNCONFIRMED' : 'HELM_COMMAND_TRANSPORT',
          startGranted,
          message
        )
      )
    }
    function send(packet) {
      if (!client.stdin.destroyed && client.stdin.writable) {
        client.stdin.write(JSON.stringify(packet) + '\n')
      }
    }
    function abort() {
      if (settled || terminal) return
      cancellation ||= 'cancelled'
      send({ type: 'cancel' })
      stopTimer ||= setTimeout(() => {
        uncertain(
          'The command stop could not be confirmed. Check the selected app before running it again.'
        )
      }, killGraceMs + processGraceMs)
    }
    try {
      const launch = transport || {
        command: dockerPath,
        args: ['exec', '-i', containerName, 'node', '-e', source]
      }
      client = spawn(launch.command, launch.args || ['-e', source], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: launch.env || process.env,
        cwd: launch.cwd
      })
      client.stdin.on('error', () => {})
      client.stderr.on('data', () => {}) // Docker diagnostics are not app output.
      client.once('error', (error) => uncertain(error.message))
      client.once('close', () => {
        if (!settled)
          uncertain(
            'The command connection closed without a verified terminal result.'
          )
      })
      client.stdout.on('data', (chunk) => {
        if (settled) return
        line += decoder.write(chunk)
        if (Buffer.byteLength(line) > 2 * maxOutputBytes + 128 * 1024) {
          send({ type: 'cancel' })
          uncertain('The command supervisor returned an invalid response.')
          return
        }
        let newline
        while ((newline = line.indexOf('\n')) >= 0 && !settled) {
          const encoded = line.slice(0, newline)
          line = line.slice(newline + 1)
          let packet
          try {
            packet = JSON.parse(encoded)
            if (packet.version !== PROTOCOL_VERSION) throw new Error()
          } catch {
            send({ type: 'cancel' })
            uncertain('The command supervisor returned an invalid response.')
            return
          }
          if (packet.type === 'ready') {
            if (startGranted) continue
            if (cancellation || signal?.aborted) {
              abort()
            } else {
              startGranted = true
              send({ type: 'start', argv })
            }
          } else if (packet.type === 'started') {
            try {
              onEvent?.({ type: 'started' })
            } catch {
              abort()
            }
          } else if (['stdout', 'stderr'].includes(packet.type)) {
            if (typeof packet.text !== 'string') {
              uncertain('The command supervisor returned invalid output.')
              return
            }
            const bytes = Buffer.byteLength(packet.text)
            if (outputBytes + bytes > maxOutputBytes) {
              truncated = true
              continue
            }
            outputBytes += bytes
            output += packet.text
            if (packet.type === 'stdout') stdout += packet.text
            else stderr += packet.text
            try {
              onEvent?.({ type: packet.type, text: packet.text })
            } catch {
              abort()
            }
          } else if (packet.type === 'result') {
            if (
              !packet.result ||
              ![
                'success',
                'error',
                'cancelled',
                'timeout',
                'unconfirmed'
              ].includes(packet.result.status)
            ) {
              uncertain('The command supervisor returned an invalid result.')
              return
            }
            terminal = packet.result
            finish({ ...terminal, truncated: truncated || terminal.truncated })
          }
        }
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      timer = setTimeout(() => {
        cancellation ||= 'timeout'
        send({ type: 'cancel', reason: 'timeout' })
        uncertain(
          'The command deadline passed without a verified terminal result. Check the selected app before running it again.'
        )
      }, deadline)
    } catch (error) {
      uncertain(error.message)
    }
  })

  function failure(status, code, terminationUnconfirmed, message) {
    return {
      success: false,
      status,
      exitCode: null,
      signal: null,
      durationMs: Date.now() - startedAt,
      terminationConfirmed: !terminationUnconfirmed,
      terminationScope: 'foreground-process-group',
      error: { code, message: message || 'Helm command was cancelled.' }
    }
  }
}

function validateOptions({
  argv,
  executionId,
  timeoutMs,
  killGraceMs,
  maxOutputBytes
}) {
  if (
    !Array.isArray(argv) ||
    !argv.length ||
    argv.length > 128 ||
    argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
    !argv[0] ||
    Buffer.byteLength(JSON.stringify(argv)) > 128 * 1024
  ) {
    throw new Error('Invalid Helm command arguments.')
  }
  if (!/^[a-f0-9-]{36}$/i.test(executionId))
    throw new Error('Invalid Helm command execution ID.')
  for (const value of [timeoutMs, killGraceMs, maxOutputBytes]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 64 * 1024 * 1024)
      throw new Error('Invalid Helm command limits.')
  }
}

function buildRunnerSource(options) {
  const launchSails = require('./helm-command-sails')
  return `(${supervisorMain.toString()})(${JSON.stringify(
    options
  )}, (${resolveAppContext.toString()}), (${guardianMain.toString()}), (${launchSails.toString()}), (${createOwnershipTracker.toString()}))`
}

/** Embedded into the selected container; no Slipway install is required there. */
function supervisorMain(
  options,
  resolveContext,
  guardianMain,
  launchSails,
  createOwnershipTracker
) {
  const fs = require('node:fs')
  const { spawn } = require('node:child_process')
  const { StringDecoder } = require('node:string_decoder')
  let guardian
  let result
  let stopping
  let started = false
  let finished = false
  let buffer = ''
  let watchdog
  let hardDeadline
  let ownership
  const emit = (packet) => {
    if (!process.stdout.destroyed)
      process.stdout.write(JSON.stringify({ version: 1, ...packet }) + '\n')
  }
  const fail = (status, code, message, confirmed = true) => ({
    success: false,
    status,
    exitCode: null,
    signal: null,
    terminationConfirmed: confirmed,
    terminationScope: 'foreground-process-group',
    error: { code, message }
  })
  const finish = (value) => {
    if (finished) return
    finished = true
    clearTimeout(watchdog)
    clearTimeout(hardDeadline)
    const encoded =
      JSON.stringify({ version: 1, type: 'result', result: value }) + '\n'
    process.stdout.write(encoded, () => process.exit(0))
    setTimeout(() => process.exit(1), 1000).unref()
  }
  const cancel = (reason = 'cancelled') => {
    stopping ||= reason
    if (!guardian) {
      finish(
        fail(
          stopping,
          stopping === 'timeout' ? 'HELM_TIMEOUT' : 'HELM_CANCELLED',
          'Helm command did not start.'
        )
      )
    } else if (!guardian.stdin.destroyed) {
      guardian.stdin.write(
        JSON.stringify({ type: 'cancel', reason: stopping }) + '\n'
      )
    }
  }
  process.stdout.on('error', () => cancel())
  process.stdin.on('end', () => cancel())
  process.stdin.on('error', () => cancel())
  process.on('SIGTERM', () => cancel())
  process.on('SIGINT', () => cancel())
  const controlDecoder = new StringDecoder('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += controlDecoder.write(chunk)
    if (Buffer.byteLength(buffer) > 256 * 1024) return cancel()
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0 && !finished) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let packet
      try {
        packet = JSON.parse(line)
      } catch {
        cancel()
        return
      }
      if (packet.type === 'cancel')
        cancel(packet.reason === 'timeout' ? 'timeout' : 'cancelled')
      else if (packet.type === 'start' && !started && !stopping)
        start(packet.argv)
    }
  })
  watchdog = setTimeout(() => cancel('timeout'), options.timeoutMs)
  hardDeadline = setTimeout(
    () =>
      finish(
        fail(
          'unconfirmed',
          'HELM_COMMAND_UNCONFIRMED',
          'The command supervisor could not confirm termination.',
          false
        )
      ),
    options.timeoutMs + options.killGraceMs + 5000
  )
  emit({ type: 'ready' })

  function start(argv) {
    started = true
    try {
      if (
        !Array.isArray(argv) ||
        !argv.length ||
        argv.some((arg) => typeof arg !== 'string' || arg.includes('\0'))
      )
        throw new Error('Invalid command arguments.')
      if (
        !options.expectedRuntime?.appId ||
        !options.expectedRuntime?.deploymentId
      )
        throw new Error('Helm commands require a verified deployed runtime.')
      const context = resolveContext({
        expectedRuntime: { ...options.expectedRuntime, required: true },
        includeProcessIdentity: true
      })
      // Capture identities BEFORE any execution-owned process can exist. An
      // unchanged pre-existing PID/start-tick pair cannot be our descendant.
      // In particular its protected environment is irrelevant to cleanup.
      ownership = createOwnershipTracker({ executionId: options.executionId })
      const { env, ...commandContext } = context
      const source = `(${guardianMain.toString()})(${JSON.stringify({
        ...options,
        argv,
        context: commandContext
      })}, (${launchSails.toString()}))`
      guardian = spawn(context.argv[0], ['-e', source], {
        cwd: context.appPath,
        env: { ...context.env, SLIPWAY_HELM_EXECUTION_ID: options.executionId },
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      guardian.stdin.on('error', () => {})
      guardian.stderr.on('data', () => {})
      let pending = ''
      const decoder = new StringDecoder('utf8')
      guardian.stdout.on('data', (chunk) => {
        pending += decoder.write(chunk)
        if (
          Buffer.byteLength(pending) >
          2 * options.maxOutputBytes + 128 * 1024
        )
          return cancel()
        let newline
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          try {
            const packet = JSON.parse(line)
            if (packet.type === 'result') result = packet.result
            else emit(packet)
          } catch {
            cancel()
          }
        }
      })
      guardian.once('error', () =>
        finish(
          fail(
            'error',
            'HELM_COMMAND_SPAWN',
            'The command supervisor could not start.'
          )
        )
      )
      guardian.once('close', async () => {
        // The guardian self-signals its own group. Never signal a numeric PID
        // received from a file, nor assume that a closed Docker client killed it.
        let survivors
        let verificationError
        try {
          survivors = ownership.hasSurvivors(guardian.pid)
          const verifyUntil = Date.now() + 250
          while (survivors && Date.now() < verifyUntil) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            survivors = ownership.hasSurvivors(guardian.pid)
          }
        } catch (error) {
          verificationError = error.ownershipDiagnostic || {
            stage: 'verification',
            code: error.code || 'UNKNOWN'
          }
          survivors = true
        }
        if (survivors || !result) {
          finish({
            ...fail(
              'unconfirmed',
              'HELM_COMMAND_UNCONFIRMED',
              'Command termination could not be confirmed. A detached child may still be running; check the selected app before running it again.',
              false
            ),
            terminationDiagnostic: verificationError || {
              stage: result ? 'surviving-process' : 'missing-result'
            }
          })
        } else
          finish({
            ...result,
            terminationConfirmed: true,
            terminationScope: 'foreground-process-group'
          })
      })
    } catch (error) {
      finish(
        fail(
          'error',
          error.code || 'HELM_APP_CONTEXT_UNAVAILABLE',
          error.message
        )
      )
    }
  }
}

/** The group leader stays alive until cleanup and ONLY signals its own group. */
function guardianMain(options, launchSails) {
  const { spawn } = require('node:child_process')
  const { StringDecoder } = require('node:string_decoder')
  let child
  let reason
  let exitCode = null
  let exitSignal = null
  let exited = false
  let spawnError
  let cleanupTimer
  let forceTimer
  let forceRequested = false
  let emittedBytes = 0
  let observedBytes = 0
  let truncated = false
  let finished = false
  const emit = (packet) => process.stdout.write(JSON.stringify(packet) + '\n')
  const decoders = {
    stdout: new StringDecoder('utf8'),
    stderr: new StringDecoder('utf8')
  }
  const output = (type, chunk, end = false) => {
    if (finished) return
    observedBytes = Math.min(
      Number.MAX_SAFE_INTEGER,
      observedBytes + chunk.length
    )
    let text = end ? decoders[type].end() : decoders[type].write(chunk)
    const remaining = options.maxOutputBytes - emittedBytes
    if (Buffer.byteLength(text) > remaining) {
      truncated = true
      let bytes = 0
      let prefix = ''
      for (const point of text) {
        const size = Buffer.byteLength(point)
        if (bytes + size > remaining) break
        prefix += point
        bytes += size
      }
      text = prefix
    }
    if (text) {
      emittedBytes += Buffer.byteLength(text)
      // Small complete-character frames bound control-channel buffering even
      // when JSON must escape every output character.
      const points = Array.from(text)
      for (let index = 0; index < points.length; index += 1024) {
        emit({ type, text: points.slice(index, index + 1024).join('') })
      }
    }
  }
  const cleanup = () => {
    if (cleanupTimer) return
    // Keeping this leader alive makes group identity stable until the trusted
    // leader itself performs SIGKILL. No PID-file lookup / reuse race exists.
    process.kill(-process.pid, 'SIGTERM')
    cleanupTimer = setTimeout(() => {
      if (!exited && !spawnError && child) {
        forceRequested = true
        // This is our own ChildProcess handle, still owned until its exit is
        // reaped. Observe its native exit before the guardian kills the group.
        child.kill('SIGKILL')
        forceTimer = setTimeout(finalize, 1000)
      } else finalize()
    }, Math.max(50, options.killGraceMs))
  }
  const finalize = () => {
    if (finished) return
    clearTimeout(forceTimer)
    finished = true
    const status =
      reason || (spawnError || exitCode !== 0 ? 'error' : 'success')
    const error = reason
      ? {
          code: reason === 'timeout' ? 'HELM_TIMEOUT' : 'HELM_CANCELLED',
          message:
            reason === 'timeout'
              ? 'Helm command timed out.'
              : 'Helm command was cancelled.'
        }
      : spawnError
      ? {
          code: 'HELM_COMMAND_SPAWN',
          message: spawnError.message
        }
      : exitCode !== 0
      ? {
          code: 'HELM_COMMAND_FAILED',
          message: `Command exited ${
            exitSignal ? 'with signal ' + exitSignal : 'with code ' + exitCode
          }.`
        }
      : null
    const result = {
      success: status === 'success',
      status,
      exitCode,
      signal: exitSignal,
      exitStatusObserved: exited || Boolean(spawnError),
      terminationSignal: 'SIGKILL',
      outputBytes: emittedBytes,
      observedOutputBytes: observedBytes,
      truncated,
      error
    }
    // If the kernel could not reap the command, leave native exit/signal
    // unknown. The supervisor must still establish that the group is gone.
    process.stdout.write(
      JSON.stringify({ type: 'result', result }) + '\n',
      () => process.kill(-process.pid, 'SIGKILL')
    )
    setTimeout(() => process.kill(-process.pid, 'SIGKILL'), 1000)
  }
  // Swallow group TERM in this trusted leader; the command retains normal
  // signal semantics. The leader intentionally dies with its group at the end.
  process.on('SIGTERM', () => {})
  process.on('SIGINT', () => {})
  process.stdout.on('error', () => {
    reason ||= 'cancelled'
    cleanup()
  })
  process.stdin.on('end', () => {
    reason ||= 'cancelled'
    cleanup()
  })
  process.stdin.on('error', () => {
    reason ||= 'cancelled'
    cleanup()
  })
  let control = ''
  process.stdin.on('data', (chunk) => {
    if (exited || spawnError) return
    control += chunk.toString('utf8')
    if (control.length > 1024) {
      reason ||= 'cancelled'
      cleanup()
      return
    }
    let newline
    while ((newline = control.indexOf('\n')) >= 0) {
      const encoded = control.slice(0, newline)
      control = control.slice(newline + 1)
      let packet
      try {
        packet = JSON.parse(encoded)
      } catch {
        packet = {}
      }
      reason ||= packet.reason === 'timeout' ? 'timeout' : 'cancelled'
      cleanup()
    }
  })
  const deadline = setTimeout(() => {
    reason ||= 'timeout'
    cleanup()
  }, options.timeoutMs)
  try {
    let [command, ...args] = options.argv
    if (command === 'sails') {
      command = options.context.argv[0]
      args = [
        '-e',
        `(${launchSails.toString()})(${JSON.stringify({
          argv: options.argv,
          appContext: options.context
        })})`
      ]
    } else if (command === 'node') command = options.context.argv[0]
    child = spawn(command, args, {
      cwd: options.context.appPath,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', (chunk) => output('stdout', chunk))
    child.stderr.on('data', (chunk) => output('stderr', chunk))
    child.stdout.once('end', () => output('stdout', Buffer.alloc(0), true))
    child.stderr.once('end', () => output('stderr', Buffer.alloc(0), true))
    child.once('spawn', () => emit({ type: 'started' }))
    child.once('error', (error) => {
      spawnError = error
      clearTimeout(deadline)
      cleanup()
    })
    child.once('exit', (code, signal) => {
      exited = true
      exitCode = code
      exitSignal = signal
      clearTimeout(deadline)
      if (forceRequested) finalize()
      else cleanup()
    })
  } catch (error) {
    spawnError = error
    clearTimeout(deadline)
    cleanup()
  }
}

/**
 * Prove cleanup using process identities, not permission-error suppression.
 * This is serialized into the container and deliberately reads no environment
 * from an unchanged process that demonstrably predates command launch.
 */
function createOwnershipTracker({
  executionId,
  fs = require('node:fs'),
  procRoot = '/proc',
  ownPid = process.pid
}) {
  const baseline = Object.create(null)
  const vanished = (error) => ['ENOENT', 'ESRCH'].includes(error.code)
  const fail = (error, stage, pid) => {
    error.ownershipDiagnostic = {
      stage,
      code: error.code || 'UNKNOWN',
      pid: Number(pid)
    }
    throw error
  }
  const pids = () =>
    fs.readdirSync(procRoot).filter((name) => /^\d+$/.test(name))
  const identity = (pid) => {
    const stat = fs.readFileSync(`${procRoot}/${pid}/stat`, 'utf8')
    const fields = stat
      .slice(stat.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/)
    if (!/^\d+$/.test(fields[19] || '') || !/^\d+$/.test(fields[2] || '')) {
      const error = new Error('Malformed process ownership metadata.')
      error.code = 'HELM_PROCESS_IDENTITY_INVALID'
      throw error
    }
    return {
      state: fields[0],
      groupId: Number(fields[2]),
      startTicks: fields[19]
    }
  }
  for (const pid of pids()) {
    try {
      baseline[pid] = identity(pid).startTicks
    } catch (error) {
      if (!vanished(error)) fail(error, 'capture-identity', pid)
    }
  }
  return {
    baseline,
    hasSurvivors(groupId) {
      for (const pid of pids()) {
        if (Number(pid) === ownPid) continue
        let current
        try {
          current = identity(pid)
        } catch (error) {
          if (vanished(error)) continue
          fail(error, 'read-identity', pid)
        }
        if (['Z', 'X'].includes(current.state)) continue
        // Group evidence always wins, even if a caller supplied stale baseline
        // information. Never hide a known group member behind another filter.
        if (current.groupId === groupId) return true
        if (baseline[pid] === current.startTicks) continue
        let env
        try {
          env = fs.readFileSync(`${procRoot}/${pid}/environ`, 'utf8')
        } catch (error) {
          if (vanished(error)) continue
          fail(error, 'read-environment', pid)
        }
        if (
          env.split('\0').includes(`SLIPWAY_HELM_EXECUTION_ID=${executionId}`)
        )
          return true
        // An unrelated PID reused while read must not clear a possibly-owned
        // process. Fail closed rather than accepting a mixed-identity sample.
        try {
          if (identity(pid).startTicks !== current.startTicks) {
            const error = new Error(
              'Process identity changed during cleanup verification.'
            )
            error.code = 'HELM_PROCESS_IDENTITY_CHANGED'
            fail(error, 'recheck-identity', pid)
          }
        } catch (error) {
          if (!vanished(error)) fail(error, 'recheck-identity', pid)
        }
      }
      return false
    }
  }
}

module.exports = {
  buildRunnerSource,
  executeCommand,
  validateOptions,
  createOwnershipTracker
}
