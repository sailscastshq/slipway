const { spawn } = require('child_process')

const RESULT_MARKER = '___SLIPWAY_BRIDGE_WORKER_RESULT___'
const BOOT_ERROR_MARKER = '___SLIPWAY_BRIDGE_WORKER_BOOT_ERROR___'
const MAX_CODE_BYTES = 512 * 1024
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const workers = new Map()
let nextJobId = 1
let teardownRegistered = false

module.exports = {
  friendlyName: 'Execute in container',

  description:
    'Execute JavaScript through one warm Sails runtime per running app container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name of the running app'
    },
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code to execute'
    },
    timeout: {
      type: 'number',
      defaultsTo: 60000,
      description: 'Timeout in milliseconds'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, code, timeout }) {
    registerTeardown()

    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const key = `${dockerPath}\u0000${containerName}`
    let worker = workers.get(key)
    if (!worker || worker.closed) {
      worker = createWorker({ key, dockerPath, containerName })
      workers.set(key, worker)
    }

    return execute(worker, code, timeout)
  }
}

function createWorker({ key, dockerPath, containerName }) {
  const proc = spawn(dockerPath, [
    'exec',
    '-e',
    'NODE_ENV=production',
    '-i',
    containerName,
    'node',
    '-e',
    buildWorkerSource()
  ])
  const worker = {
    key,
    proc,
    pending: new Map(),
    stdout: '',
    stderr: '',
    closed: false
  }

  proc.stdout.on('data', (data) => {
    worker.stdout += data.toString()
    if (Buffer.byteLength(worker.stdout) > MAX_OUTPUT_BYTES) {
      failWorker(worker, 'Bridge worker output exceeded the safe limit.')
      return
    }
    consumeWorkerOutput(worker)
  })

  proc.stderr.on('data', (data) => {
    if (Buffer.byteLength(worker.stderr) >= MAX_STDERR_BYTES) return
    worker.stderr = `${worker.stderr}${data.toString()}`.slice(
      0,
      MAX_STDERR_BYTES
    )
  })

  proc.on('error', (error) => {
    failWorker(worker, error.message)
  })

  proc.on('close', (exitCode) => {
    if (worker.closed) return
    const detail = worker.stderr.trim()
    failWorker(
      worker,
      detail || `Bridge worker stopped unexpectedly (exit ${exitCode}).`,
      exitCode || 1
    )
  })

  proc.stdin.on('error', (error) => {
    failWorker(worker, error.message)
  })

  return worker
}

function execute(worker, code, timeout) {
  return new Promise((resolve) => {
    if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
      return resolve(failure('Bridge worker code exceeded the safe limit.'))
    }
    if (worker.closed || !worker.proc.stdin.writable) {
      return resolve(failure('Bridge worker is unavailable.'))
    }

    const id = nextJobId++
    const timer = setTimeout(() => {
      if (!worker.pending.has(id)) return
      worker.pending.delete(id)
      resolve(failure(`Bridge worker timed out after ${timeout}ms.`))
      failWorker(worker, 'Bridge worker was restarted after a timeout.')
    }, timeout)

    worker.pending.set(id, { resolve, timer })
    try {
      worker.proc.stdin.write(`${JSON.stringify({ id, code })}\n`)
    } catch (error) {
      clearTimeout(timer)
      worker.pending.delete(id)
      resolve(failure(error.message))
      failWorker(worker, error.message)
    }
  })
}

function consumeWorkerOutput(worker) {
  let newlineIndex
  while ((newlineIndex = worker.stdout.indexOf('\n')) !== -1) {
    const line = worker.stdout.slice(0, newlineIndex)
    worker.stdout = worker.stdout.slice(newlineIndex + 1)

    const bootErrorIndex = line.indexOf(BOOT_ERROR_MARKER)
    if (bootErrorIndex !== -1) {
      failWorker(
        worker,
        line.slice(bootErrorIndex + BOOT_ERROR_MARKER.length) ||
          'The target Sails app could not start.'
      )
      return
    }

    const markerIndex = line.indexOf(RESULT_MARKER)
    if (markerIndex === -1) continue

    let result
    try {
      result = JSON.parse(line.slice(markerIndex + RESULT_MARKER.length))
    } catch {
      failWorker(worker, 'Bridge worker returned an invalid response.')
      return
    }

    const pending = worker.pending.get(result.id)
    if (!pending) continue
    clearTimeout(pending.timer)
    worker.pending.delete(result.id)
    pending.resolve({
      success: result.success === true,
      output: typeof result.output === 'string' ? result.output : '',
      error: typeof result.error === 'string' ? result.error : null,
      exitCode: result.success === true ? 0 : 1
    })
  }
}

function failWorker(worker, message, exitCode = 1) {
  if (worker.closed) return
  worker.closed = true
  if (workers.get(worker.key) === worker) workers.delete(worker.key)

  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timer)
    pending.resolve(failure(message, exitCode))
  }
  worker.pending.clear()

  if (!worker.proc.killed) worker.proc.kill('SIGTERM')
}

function failure(message, exitCode = 1) {
  return {
    success: false,
    output: '',
    error: message || 'Bridge worker failed.',
    exitCode
  }
}

function registerTeardown() {
  if (teardownRegistered) return
  teardownRegistered = true
  sails.once('lower', closeAllWorkers)
}

function closeAllWorkers() {
  for (const worker of workers.values()) {
    failWorker(worker, 'Slipway is shutting down.')
  }
  workers.clear()
}

function buildWorkerSource() {
  return `
const readline = require('node:readline');
const RESULT_MARKER = ${JSON.stringify(RESULT_MARKER)};
const BOOT_ERROR_MARKER = ${JSON.stringify(BOOT_ERROR_MARKER)};

(async () => {
  let sailsApp;
  try {
    sailsApp = require('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
        models: { migrate: 'safe' },
        hooks: {
          http: false,
          views: false,
          sockets: false,
          pubsub: false,
          grunt: false,
          flash: false,
          session: false
        },
        security: { csrf: false },
        log: { level: 'silent' }
      }, (error) => error ? reject(error) : resolve());
    });
  } catch (error) {
    process.stdout.write(
      BOOT_ERROR_MARKER + (error.stack || error.message || String(error)) + '\\n'
    );
    process.exit(1);
    return;
  }

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const input = readline.createInterface({ input: process.stdin });
  let queue = Promise.resolve();

  input.on('line', (line) => {
    queue = queue.then(async () => {
      let job;
      try {
        job = JSON.parse(line);
        const run = new AsyncFunction('sails', 'require', job.code);
        const value = await run(sailsApp, require);
        const output = value === undefined ? '' : JSON.stringify(value);
        process.stdout.write(
          RESULT_MARKER + JSON.stringify({
            id: job.id,
            success: true,
            output,
            error: null
          }) + '\\n'
        );
      } catch (error) {
        process.stdout.write(
          RESULT_MARKER + JSON.stringify({
            id: job && job.id,
            success: false,
            output: '',
            error: error.stack || error.message || String(error)
          }) + '\\n'
        );
      }
    });
  });

  input.on('close', () => {
    queue.finally(() => {
      if (sailsApp && sailsApp.lower) {
        sailsApp.lower(() => process.exit());
      } else {
        process.exit();
      }
    });
  });
})();
`
}
