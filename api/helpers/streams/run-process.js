const { spawn } = require('node:child_process')
const { Writable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const createByteLimitTransform = require('../../lib/byte-limit-transform')

module.exports = {
  friendlyName: 'Run process',

  description:
    'Run a subprocess with bounded streaming input, output, stderr, and duration.',

  inputs: {
    command: {
      type: 'string',
      required: true
    },
    args: {
      type: 'ref',
      defaultsTo: []
    },
    input: {
      type: 'ref',
      description: 'Optional readable stream for stdin.'
    },
    output: {
      type: 'ref',
      description: 'Optional writable stream for stdout.'
    },
    env: {
      type: 'ref',
      description: 'Optional process environment.'
    },
    timeoutMs: {
      type: 'number',
      required: true,
      min: 1
    },
    maxInputBytes: {
      type: 'number',
      defaultsTo: Number.MAX_SAFE_INTEGER,
      min: 1
    },
    maxOutputBytes: {
      type: 'number',
      defaultsTo: Number.MAX_SAFE_INTEGER,
      min: 1
    },
    maxStderrBytes: {
      type: 'number',
      required: true,
      min: 1
    },
    maxStdoutBytes: {
      type: 'number',
      defaultsTo: 64 * 1024,
      min: 1
    },
    captureStdout: {
      type: 'boolean',
      defaultsTo: false
    },
    signal: {
      type: 'ref',
      description: 'Optional AbortSignal.'
    },
    killGraceMs: {
      type: 'number',
      defaultsTo: 5000,
      min: 1
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    command,
    args,
    input,
    output,
    env,
    timeoutMs,
    maxInputBytes,
    maxOutputBytes,
    maxStderrBytes,
    maxStdoutBytes,
    captureStdout,
    signal,
    killGraceMs
  }) {
    const startedAt = Date.now()
    const child = spawn(command, args, {
      env: env || process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stderr = createBoundedCapture(maxStderrBytes)
    const stdout = createBoundedCapture(maxStdoutBytes)
    child.stderr.on('data', stderr.add)

    const closePromise = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, processSignal) => {
        resolve({ code, signal: processSignal })
      })
    })

    const inputLimiter = createByteLimitTransform({
      maxBytes: maxInputBytes,
      label: 'Process input'
    })
    const outputLimiter = createByteLimitTransform({
      maxBytes: maxOutputBytes,
      label: 'Process output'
    })

    let pipelineFailure
    const rawInputPromise = input
      ? pipeline(input, inputLimiter, child.stdin)
      : Promise.resolve(child.stdin.end())

    const outputTarget =
      output ||
      new Writable({
        write(chunk, encoding, callback) {
          if (captureStdout) stdout.add(chunk)
          callback()
        }
      })
    const rawOutputPromise = pipeline(child.stdout, outputLimiter, outputTarget)
    const stopOnPipelineFailure = (promise) =>
      promise.catch((error) => {
        pipelineFailure ||= error
        if (!isExpectedPipeClosure(error)) terminate(child, killGraceMs)
        throw error
      })
    const inputPromise = stopOnPipelineFailure(rawInputPromise)
    const outputPromise = stopOnPipelineFailure(rawOutputPromise)

    const interruption = createInterruption({
      signal,
      timeoutMs,
      onInterrupt: () => terminate(child, killGraceMs)
    })

    try {
      const [closeResult, inputResult, outputResult] = await Promise.race([
        Promise.allSettled([closePromise, inputPromise, outputPromise]),
        interruption.promise
      ])

      if (closeResult.status === 'rejected') throw closeResult.reason

      const { code, signal: processSignal } = closeResult.value
      const inputError =
        inputResult.status === 'rejected' ? inputResult.reason : null
      const outputError =
        outputResult.status === 'rejected' ? outputResult.reason : null
      const streamError = outputError || inputError || pipelineFailure

      if (streamError && isPrimaryStreamError(streamError, code)) {
        throw streamError
      }

      if (code !== 0) {
        const detail = stderr.value().trim()
        const error = new Error(
          `Process exited with code ${code}${
            processSignal ? ` (${processSignal})` : ''
          }${detail ? `: ${detail}` : ''}`
        )
        error.code = 'PROCESS_FAILED'
        error.exitCode = code
        error.stderr = stderr.value()
        error.stderrTruncated = stderr.truncated()
        throw error
      }

      if (streamError) throw streamError

      return {
        durationMs: Date.now() - startedAt,
        inputBytes: input ? inputLimiter.getBytes() : 0,
        outputBytes: outputLimiter.getBytes(),
        stdout: stdout.value(),
        stdoutTruncated: stdout.truncated(),
        stderr: stderr.value(),
        stderrTruncated: stderr.truncated()
      }
    } catch (error) {
      terminate(child, killGraceMs)
      await Promise.allSettled([closePromise, inputPromise, outputPromise])
      error.stdout = stdout.value()
      error.stdoutTruncated = stdout.truncated()
      error.stderr ||= stderr.value()
      error.stderrTruncated ||= stderr.truncated()
      throw error
    } finally {
      interruption.cleanup()
      child.stderr.off('data', stderr.add)
    }
  }
}

function createBoundedCapture(maxBytes) {
  const chunks = []
  let capturedBytes = 0
  let totalBytes = 0

  return {
    add(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length

      if (capturedBytes >= maxBytes) return

      const slice = buffer.subarray(0, maxBytes - capturedBytes)
      chunks.push(slice)
      capturedBytes += slice.length
    },
    value() {
      return Buffer.concat(chunks, capturedBytes).toString('utf8')
    },
    truncated() {
      return totalBytes > capturedBytes
    }
  }
}

function createInterruption({ signal, timeoutMs, onInterrupt }) {
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject
  })

  const interrupt = (error) => {
    onInterrupt(error)
    rejectPromise(error)
  }

  const timeout = setTimeout(() => {
    const error = new Error(`Process timed out after ${timeoutMs}ms.`)
    error.code = 'PROCESS_TIMEOUT'
    interrupt(error)
  }, timeoutMs)
  timeout.unref()

  const onAbort = () => {
    const signalReason = signal?.reason
    const error =
      signalReason instanceof Error &&
      typeof signalReason.code === 'string' &&
      signalReason.code
        ? signalReason
        : new Error('Process was cancelled.')
    error.code = error.code || 'PROCESS_ABORTED'
    interrupt(error)
  }

  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    promise,
    cleanup() {
      clearTimeout(timeout)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
}

function terminate(child, killGraceMs) {
  if (child.exitCode !== null || child.signalCode !== null) return

  child.kill('SIGTERM')
  const forceKill = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }, killGraceMs)
  forceKill.unref()

  child.stdin.destroy()
  child.stdout.destroy()
}

function isPrimaryStreamError(error, processExitCode) {
  if (processExitCode === 0 || processExitCode === null) return true
  return !isExpectedPipeClosure(error)
}

function isExpectedPipeClosure(error) {
  return ['EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code)
}
