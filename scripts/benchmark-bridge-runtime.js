#!/usr/bin/env node

const { spawn } = require('node:child_process')

const containerName = process.argv[2]
const shouldAssert = process.argv.includes('--assert')

if (
  !containerName ||
  !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(containerName)
) {
  throw new Error(
    'Usage: node scripts/benchmark-bridge-runtime.js <container-name> [--assert]'
  )
}

const lowerListeners = []
global.sails = {
  config: { docker: { binaryPath: 'docker' } },
  once(event, listener) {
    if (event === 'lower') lowerListeners.push(listener)
  }
}

const executeInContainer = require('../api/helpers/bridge/execute-in-container')

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    for (const listener of lowerListeners) listener()
  })

async function main() {
  const operation = 'return { modelCount: Object.keys(sails.models).length }'
  const oneShot = []
  for (let index = 0; index < 2; index += 1) {
    oneShot.push(await measure(() => executeOneShot(operation)))
  }

  const prewarm = await measure(() => executeWarm(operation))
  const warm = []
  for (let index = 0; index < 5; index += 1) {
    warm.push(await measure(() => executeWarm(operation)))
  }

  const report = {
    containerName,
    before: {
      lifecycle: 'one docker exec plus one Sails load/lower per operation',
      milliseconds: oneShot
    },
    after: {
      prewarmMilliseconds: prewarm,
      lifecycle: 'one prewarmed worker reused for every operation',
      warmMilliseconds: warm,
      warmMaximumMilliseconds: Math.max(...warm)
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (shouldAssert && report.after.warmMaximumMilliseconds >= 500) {
    throw new Error(
      `Warm Bridge operation exceeded 500ms (${report.after.warmMaximumMilliseconds}ms).`
    )
  }
}

async function executeWarm(code) {
  const result = await executeInContainer.fn({
    containerName,
    code,
    timeout: 60000
  })
  if (!result.success) {
    throw new Error(result.error || 'Warm Bridge operation failed.')
  }
  return JSON.parse(result.output)
}

function executeOneShot(code) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec',
      '-e',
      'NODE_ENV=production',
      '-i',
      containerName,
      'node'
    ])
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        return reject(
          new Error(stderr.trim() || `One-shot worker exited ${exitCode}.`)
        )
      }
      return resolve()
    })
    child.stdin.end(buildOneShotSource(code))
  })
}

function buildOneShotSource(code) {
  return `
(async () => {
  let sailsApp;
  try {
    sailsApp = require('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
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
    await (async function () { ${code} })();
  } catch (error) {
    process.stderr.write(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
  if (sailsApp && sailsApp.lower) {
    sailsApp.lower(() => process.exit());
  } else {
    process.exit();
  }
})();
`
}

async function measure(operation) {
  const startedAt = process.hrtime.bigint()
  await operation()
  return Number((process.hrtime.bigint() - startedAt) / 1000000n)
}
