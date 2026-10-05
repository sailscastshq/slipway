const path = require('node:path')
const fs = require('node:fs')
const { fork } = require('node:child_process')

const codes = require('./upgrade-error-codes')
const fenceReasons = require('./upgrade-fence-reasons')
const limit = 1024 * 1024
function failure(code, reason) {
  return Object.assign(
    new Error('Upgrade worker requires recovery inspection.'),
    {
      code,
      reason:
        code === 'upgradeFenceUnproved' && fenceReasons.has(reason)
          ? reason
          : undefined
    }
  )
}
// The worker is trusted application code, never a caller-supplied executable.
// Resolve only after native exit: a timeout must not return while SQLite can
// still commit. This is a hard wall-clock bound on synchronous native work.
function createSupervisor(worker) {
  return function supervise({
    operation,
    input,
    timeoutMs,
    verifyFence,
    audit
  }) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60 * 60 * 1000 ||
      Buffer.byteLength(JSON.stringify({ operation, input })) > limit
    )
      return Promise.reject(failure('upgradeWorkerInput'))
    return new Promise((resolve, reject) => {
      const child = fork(worker, [], {
        detached: process.platform !== 'win32',
        execArgv: [],
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          NODE_ENV: 'production'
        },
        serialization: 'json',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
      const deadline = Date.now() + timeoutMs
      let guardian
      let workerClosed = false
      let guardianClosed = process.platform !== 'linux'
      let exitCode
      let exitSignal
      let result
      let error
      let outputBytes = 0
      let responded = false
      let stopping = false
      const requests = new Set()
      const stop = (code, reason) => {
        if (stopping) return
        stopping = true
        error ||= failure(code, reason)
        try {
          if (process.platform === 'win32') child.kill('SIGKILL')
          else process.kill(-child.pid, 'SIGKILL')
        } catch (killError) {
          if (killError.code !== 'ESRCH') error = failure('upgradeWorkerKill')
        }
      }
      const timer = setTimeout(() => stop('upgradeWorkerTimeout'), timeoutMs)
      const count = (chunk) => {
        outputBytes += chunk.length
        if (outputBytes > 65536) stop('upgradeWorkerOutput')
      }
      child.stdout.on('data', count)
      child.stderr.on('data', count)
      child.on('error', () => stop('upgradeWorkerFailed'))
      child.on('message', async (message) => {
        try {
          if (error) return
          if (Buffer.byteLength(JSON.stringify(message)) > limit)
            return stop('upgradeWorkerOutput')
          if (
            message?.type === 'failure' &&
            codes.has(message.code) &&
            !responded
          ) {
            error = failure(message.code, message.reason)
            return
          }
          if (message?.type === 'result' && !responded) {
            responded = true
            result = message.value
            return
          }
          if (
            responded ||
            message?.type !== 'request' ||
            !Number.isSafeInteger(message.id) ||
            requests.has(message.id) ||
            !['fence', 'audit'].includes(message.method)
          )
            return stop('upgradeWorkerProtocol')
          requests.add(message.id)
          const handler = message.method === 'fence' ? verifyFence : audit
          if (typeof handler !== 'function')
            return stop('upgradeWorkerProtocol')
          const value = await handler(...message.args, { workerPid: child.pid })
          if (!error && child.connected) {
            if (Buffer.byteLength(JSON.stringify(value ?? null)) > limit)
              return stop('upgradeWorkerOutput')
            child.send({ type: 'reply', id: message.id, value: value ?? null })
          }
        } catch (callbackError) {
          stop(
            codes.has(callbackError?.code)
              ? callbackError.code
              : 'upgradeWorkerCallback',
            callbackError?.reason
          )
        }
      })
      const finish = () => {
        if (!workerClosed || !guardianClosed) return
        clearTimeout(timer)
        if (error) reject(error)
        else if (exitCode !== 0 || exitSignal || !responded)
          reject(failure('upgradeWorkerFailed'))
        else resolve(result)
      }
      child.on('close', (code, signal) => {
        workerClosed = true
        exitCode = code
        exitSignal = signal
        if (guardian?.connected) guardian.send({ type: 'disarm' })
        finish()
      })
      if (process.platform === 'linux') {
        try {
          const stat = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8')
          const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
          guardian = fork(
            path.join(__dirname, 'upgrade-worker-guardian.js'),
            [],
            {
              execArgv: [],
              env: {},
              stdio: ['ignore', 'ignore', 'ignore', 'ipc']
            }
          )
          guardian.on('message', (message) => {
            if (message?.type !== 'armed' || error || workerClosed) return
            child.send({ operation, input, timeoutMs })
          })
          guardian.on('error', () => stop('upgradeWorkerGuardLost'))
          guardian.on('close', () => {
            guardianClosed = true
            if (!workerClosed) stop('upgradeWorkerGuardLost')
            finish()
          })
          guardian.send({ type: 'arm', pid: child.pid, start, deadline })
        } catch {
          guardianClosed = !guardian
          stop('upgradeWorkerGuardLost')
        }
      }
      if (process.platform !== 'linux')
        child.send({ operation, input, timeoutMs })
    })
  }
}
module.exports = {
  createSupervisor,
  runBounded: createSupervisor(path.join(__dirname, 'upgrade-worker.js'))
}
