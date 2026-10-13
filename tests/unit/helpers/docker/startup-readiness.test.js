const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { test } = require('sounding')
const { poll } = require('../../../../api/lib/startup-readiness')

function harness(overrides = {}) {
  let clock = 0
  const logs = []
  return {
    options: {
      timeout: 120000,
      interval: 2000,
      containerName: 'candidate-synthetic',
      port: 1337,
      path: '/health'
    },
    deps: {
      now: () => clock,
      delay: async (ms) => {
        clock += ms
      },
      inspect: async () => ({ status: 'running', running: true }),
      request: async () => (clock >= 80000 ? 204 : 503),
      log: async (line) => logs.push(line),
      sanitize: (value) => value,
      ...overrides
    },
    get clock() {
      return clock
    },
    set clock(value) {
      clock = value
    },
    logs
  }
}
test('startup: an 80 second candidate succeeds inside the 120 second window', async () => {
  const h = harness()
  const result = await poll(h.options, h.deps)
  assert.equal(result.elapsedMs, 80000)
  assert.equal(result.statusCode, 204)
  assert(h.logs.length >= 4)
})
test('startup: a running candidate returning 503 fails at the deadline', async () => {
  const h = harness({ request: async () => 503 })
  await assert.rejects(
    poll(h.options, h.deps),
    (error) =>
      error.code === 'DEPLOYMENT_STARTUP_TIMEOUT' &&
      /still running/.test(error.message) &&
      /HTTP 503/.test(error.message)
  )
  assert.equal(h.clock, 120000)
})
test('startup: connection refusal includes PORT and health path guidance', async () => {
  const h = harness({
    request: async () => {
      throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
    }
  })
  await assert.rejects(poll(h.options, h.deps), (error) =>
    /PORT/.test(error.message)
  )
})
test('startup: exited OOM candidate fails before another request', async () => {
  const h = harness({
    inspect: async () => ({ status: 'exited', exitCode: 137, oomKilled: true }),
    request: async () => assert.fail('must not request exited candidate')
  })
  await assert.rejects(
    poll(h.options, h.deps),
    (error) =>
      error.code === 'DEPLOYMENT_STARTUP_EXITED' &&
      /137/.test(error.message) &&
      /out of memory/.test(error.message)
  )
  assert.equal(h.clock, 0)
})
test('startup: a restarting candidate fails immediately', async () => {
  const h = harness({
    inspect: async () => ({ status: 'running', restarting: true })
  })
  await assert.rejects(
    poll(h.options, h.deps),
    (error) => error.code === 'DEPLOYMENT_STARTUP_EXITED'
  )
})
test('startup: a missing candidate fails immediately', async () => {
  const h = harness({
    inspect: async () => {
      throw 'notFound'
    }
  })
  await assert.rejects(
    poll(h.options, h.deps),
    (error) => error.code === 'DEPLOYMENT_CANDIDATE_MISSING'
  )
})
test('startup: unavailable inspection can still pass HTTP readiness', async () => {
  const h = harness({
    inspect: async () => {
      throw new Error('Unavailable')
    },
    request: async () => 204
  })
  assert.equal((await poll(h.options, h.deps)).statusCode, 204)
})
test('startup: late 2xx cannot pass after the deadline', async () => {
  const h = harness()
  h.deps.request = async () => {
    h.clock = 120001
    return 204
  }
  await assert.rejects(
    poll(h.options, h.deps),
    (error) => error.code === 'DEPLOYMENT_STARTUP_TIMEOUT'
  )
})
test('startup: cancellation stops before inspection or request', async () => {
  const h = harness()
  const controller = new AbortController()
  controller.abort()
  h.options.signal = controller.signal
  await assert.rejects(
    poll(h.options, h.deps),
    (error) => error.code === 'DEPLOYMENT_CANCELLED'
  )
})
test('startup: Docker DNS falls back to the mapped localhost port', async () => {
  const h = harness()
  h.options.hostPort = 1402
  let calls = 0
  h.deps.request = async (host, port) => {
    if (calls++ === 0)
      throw Object.assign(new Error('DNS'), { code: 'ENOTFOUND' })
    assert.equal(host, 'localhost')
    assert.equal(port, 1402)
    return 204
  }
  assert.equal((await poll(h.options, h.deps)).host, 'localhost')
})
test('startup: request budgets and delays shrink to the remaining deadline', async () => {
  const h = harness()
  h.options.timeout = 5100
  const budgets = []
  h.deps.request = async (a, b, c, d, e, budget) => {
    budgets.push(budget)
    return 503
  }
  await assert.rejects(poll(h.options, h.deps))
  assert.deepEqual(budgets, [5000, 3100, 1100])
  assert.equal(h.clock, 5100)
})
test('startup: unsupported windows fail instead of polling without a bound', async () => {
  const h = harness()
  h.options.timeout = 600001
  await assert.rejects(
    poll(h.options, h.deps),
    (error) => error.code === 'INVALID_STARTUP_WINDOW'
  )
})

// Execute helper boundaries with synthetic process results. No Docker command runs.
function loadHelper(filename, globals, dependencyOverrides = {}) {
  const location = path.resolve(__dirname, '../../../../api', filename)
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    Buffer,
    ...globals,
    require: (name) => {
      if (
        (name === 'node:util' || name === 'util') &&
        (dependencyOverrides['node:child_process'] ||
          dependencyOverrides.child_process)
      ) {
        return {
          promisify:
            (fn) =>
            (...args) =>
              new Promise((resolve, reject) =>
                fn(...args, (error, stdout, stderr) =>
                  error
                    ? reject(Object.assign(error, { stdout, stderr }))
                    : resolve({ stdout, stderr })
                )
              )
        }
      }
      if (Object.hasOwn(dependencyOverrides, name))
        return dependencyOverrides[name]
      return name.startsWith('.')
        ? require(path.resolve(path.dirname(location), name))
        : require(name)
    }
  }
  vm.runInNewContext(fs.readFileSync(location, 'utf8'), context, {
    filename: location
  })
  return module.exports
}
function diagnostics(processError) {
  const logs = []
  const calls = []
  const stdout = 'Listening on 1337\nAPI_TOKEN=synthetic-only-credential-770\n'
  const stderr = 'Startup crash: synthetic-only-credential-770\n'
  const helper = loadHelper(
    'helpers/docker/capture-startup-diagnostics.js',
    {
      sails: {
        config: { docker: { binaryPath: 'synthetic-docker' } },
        helpers: {
          docker: {
            getContainerStatus: {
              with: async (input) => {
                calls.push(input)
                return { status: 'exited', exitCode: 1, oomKilled: false }
              }
            }
          }
        }
      },
      Deployment: {
        appendDeployLog: async (id, output) => logs.push({ id, output })
      }
    },
    {
      'node:child_process': {
        execFile(binary, args, options, done) {
          assert.equal(binary, 'synthetic-docker')
          assert.deepEqual(Array.from(args), [
            'logs',
            '--tail',
            '100',
            '--timestamps',
            'candidate-synthetic'
          ])
          assert.equal(options.timeout, 5000)
          assert.equal(options.maxBuffer, 65536)
          done(
            processError ? new Error('Synthetic process limit') : null,
            stdout,
            stderr
          )
        }
      }
    }
  )
  return { helper, logs, calls }
}
for (const incomplete of [false, true])
  test(`startup: ${
    incomplete ? 'partial' : 'complete'
  } diagnostics preserve both channels and mask credentials`, async () => {
    const setup = diagnostics(incomplete)
    await setup.helper.fn({
      containerName: 'candidate-synthetic',
      deploymentId: 'synthetic-deploy-770',
      envVars: { API_TOKEN: 'synthetic-only-credential-770' }
    })
    assert.equal(setup.logs.length, 1)
    const log = setup.logs[0].output
    assert.match(log, /state: exited; exit code: 1/)
    assert.match(log, /Startup stdout/)
    assert.match(log, /Startup stderr/)
    assert.match(log, /Listening on 1337/)
    assert.match(log, /\[REDACTED\]/)
    assert(!log.includes('synthetic-only-credential-770'))
    assert.equal(log.includes('incomplete'), incomplete)
    assert.equal(setup.calls[0].fresh, true)
  })
test('startup: app override wins over instance default and invalid configuration fails closed', () => {
  const helper = loadHelper('helpers/docker/resolve-startup-window.js', {
    sails: { config: { custom: { deploymentStartupTimeoutSeconds: 180 } } }
  })
  assert.equal(helper.fn({ resourceLimits: {} }), 180000)
  assert.equal(
    helper.fn({ resourceLimits: { startupTimeoutSeconds: 80 } }),
    80000
  )
  for (const value of [0, 601, 5.5, false, 'bad'])
    assert.throws(() =>
      helper.fn({ resourceLimits: { startupTimeoutSeconds: value } })
    )
})
test('startup: settings validation accepts bounded integers and rejects invalid values', () => {
  const validate = require('../../../../api/helpers/configuration/validate').fn
  for (const value of [5, 120, 600, '180'])
    assert.equal(
      validate({
        values: {
          resourceLimits: {
            cpus: '1',
            memory: '512m',
            startupTimeoutSeconds: value
          }
        },
        requiredFields: []
      }).length,
      0
    )
  for (const value of [0, 601, 5.5, null, false, ''])
    assert(
      validate({
        values: {
          resourceLimits: {
            cpus: '1',
            memory: '512m',
            startupTimeoutSeconds: value
          }
        },
        requiredFields: []
      }).some((p) => p['resourceLimits.startupTimeoutSeconds'])
    )
})
test('startup: timeout-only settings edits do not update a running container and older clients preserve the override', async () => {
  let saved
  const app = {
    id: 1,
    status: 'running',
    containerName: 'candidate-synthetic',
    resourceLimits: { cpus: '1', memory: '512m', startupTimeoutSeconds: 180 },
    envVars: {}
  }
  const helper = loadHelper(
    'controllers/api/v1/app/update-app.js',
    {
      User: { forRequest: async () => ({ team: 1, teamRole: 'owner' }) },
      Project: {
        findOne: () => ({ populate: async () => ({ id: 1, team: { id: 1 } }) })
      },
      Environment: { findOne: async () => ({ id: 1 }) },
      App: {
        findOne: () => ({ decrypt: async () => app }),
        updateOne: () => ({
          set: async (update) => {
            saved = update
            return { ...app, ...update }
          }
        })
      },
      sails: {
        config: {},
        log: { info() {}, warn() {} },
        inertia: { isPrecognitive: () => false },
        helpers: {
          configuration: { validate: () => [] },
          security: { publicRecord: { with: (input) => input.record } }
        }
      }
    },
    {
      child_process: {
        execFile() {
          assert.fail('timeout-only edit must not touch Docker')
        }
      }
    }
  )
  const input = {
    projectSlug: 'synthetic',
    environmentSlug: 'production',
    appSlug: 'web'
  }
  await helper.fn.call(
    { req: {} },
    {
      ...input,
      resourceLimits: { cpus: '1', memory: '512m', startupTimeoutSeconds: 240 }
    }
  )
  assert.equal(saved.resourceLimits.startupTimeoutSeconds, 240)
  await helper.fn.call(
    { req: {} },
    { ...input, resourceLimits: { cpus: '1', memory: '512m' } }
  )
  assert.equal(saved.resourceLimits.startupTimeoutSeconds, 180)
})

for (const invalidBinding of [false, true])
  test(`startup: ${
    invalidBinding ? 'invalid verified' : 'occupied'
  } host binding retains a typed failure`, async () => {
    const helper = loadHelper(
      'helpers/docker/run-container.js',
      {
        sails: {
          config: { custom: {} },
          log: { info() {}, error() {} },
          helpers: {
            docker: {
              formatPortBinding: { with: async () => '127.0.0.1:1402:1337' },
              buildEnvArguments: { with: () => [] },
              formatError: {
                with: (input) =>
                  require('../../../../api/helpers/docker/format-error').fn(
                    input
                  )
              },
              getPortBinding: {
                with: async () => ({
                  valid: false,
                  diagnostic: 'Synthetic host binding mismatch'
                })
              }
            }
          }
        }
      },
      {
        child_process: {
          execFile(binary, args, options, done) {
            const error = invalidBinding
              ? null
              : Object.assign(new Error('Synthetic docker failure'), {
                  stderr: 'port is already allocated'
                })
            done(error, 'synthetic-container-id', error?.stderr || '')
          }
        }
      }
    )
    await assert.rejects(
      helper.fn({
        containerName: 'candidate-synthetic',
        imageName: 'synthetic:770',
        port: 1337,
        hostPort: 1402,
        envVars: {},
        resourceLimits: {}
      }),
      (error) => error.code === 'DEPLOYMENT_BINDING_FAILED'
    )
  })
