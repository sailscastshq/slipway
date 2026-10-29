const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const cp = require('node:child_process')
const contract = require('../../../../api/lib/contracts/ci-contract')
for (const mode of ['transient', 'persistent']) {
  test(`server monitor ${mode} contention preserves receipts without replaying executor`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-monitor-'))
    const originals = { spawn: cp.spawn, execFile: cp.execFile }
    for (const n of ['sails', 'App', 'CiPolicy', 'CiRun', 'Deployment'])
      originals[n] = global[n]
    const manifest = {
      scripts: {
        lint: 'node lint.js',
        test: 'node --test',
        build: 'node build.js'
      }
    }
    const runtime = 'node@sha256:' + 'a'.repeat(64),
      platform = 'linux/amd64'
    const configuration = contract.configuration(manifest, runtime, platform)
    const policy = {
      enabled: true,
      revision: 'revision',
      repositoryId: 'repository',
      branch: 'main',
      configuration: {
        automatic: true,
        execution: { runtime, platform },
        configRevision: contract.digest(configuration)
      }
    }
    let starts = 0,
      kills = 0,
      writes = 0,
      terminal,
      closed = false,
      timer
    cp.execFile = (command, args, options, callback) => {
      if (typeof options === 'function') callback = options
      callback(null, command === 'git' ? 'commit\n' : '', '')
    }
    cp.execFile[require('node:util').promisify.custom] = async (command) => ({
      stdout: command === 'git' ? 'commit\n' : '',
      stderr: ''
    })
    cp.spawn = (command, args) => {
      starts++
      const child = new EventEmitter()
      child.stderr = new EventEmitter()
      const output = args[args.indexOf('--out') + 1]
      fs.mkdirSync(output, { recursive: true })
      const report = {
        state: 'running',
        steps: [
          { name: 'install', state: 'passed', exitCode: 0 },
          { name: 'test', state: 'running' }
        ],
        id: args[args.indexOf('--run-id') + 1],
        sourceRevision: 'commit',
        manifestDigest: 'manifest',
        lockDigest: 'lock',
        configRevision: policy.configuration.configRevision
      }
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report))
      const close = () => {
        if (!closed) {
          closed = true
          child.emit('close', 1)
        }
      }
      child.kill = () => {
        kills++
        setImmediate(close)
        return true
      }
      timer = setTimeout(() => {
        report.state = 'failed'
        report.reason = 'Fixture test failed'
        report.steps[1].state = 'failed'
        fs.writeFileSync(
          path.join(output, 'report.json'),
          JSON.stringify(report)
        )
        close()
      }, 3300)
      return child
    }
    global.App = { findOne: async () => ({ id: 1 }) }
    global.CiPolicy = { findOne: async () => policy }
    global.CiRun = {
      updateOne: () => ({
        set: async (value) => {
          if (value.summary && !value.state) {
            writes++
            if (
              (mode === 'transient' && writes === 1) ||
              (mode === 'persistent' && writes > 1)
            )
              throw Object.assign(new Error('database is locked'), {
                raw: { code: 'E_BUSY' }
              })
          }
          if (value.state === 'failed') terminal = value.summary
          return { id: 1 }
        }
      })
    }
    global.Deployment = { appendBuildLog: async () => {} }
    global.sails = {
      config: { appPath: root },
      hooks: { secrets: { text: (v) => v } },
      helpers: {
        deploy: {
          assertDeploymentLease: { with: async () => ({ valid: true }) },
          recordDeploymentStage: { with: async () => ({ valid: true }) }
        },
        ci: {
          resolveSource: {
            with: async () => ({
              repositoryId: 'repository',
              manifest,
              commit: 'commit',
              manifestDigest: 'manifest',
              lockDigest: 'lock'
            })
          },
          reserveServerRun: { with: async () => ({ id: 1 }) }
        }
      }
    }
    const file = require.resolve('../../../../api/helpers/ci/run-server-checks')
    delete require.cache[file]
    try {
      await assert.rejects(
        require(file).fn({
          appId: '1',
          contextPath: root,
          deploymentId: '1',
          leaseToken: 'lease',
          policyRevision: 'revision'
        }),
        (error) => {
          if (starts === 0) console.error(error)
          return true
        }
      )
      assert.equal(starts, 1)
      assert.equal(terminal.steps[0].state, 'passed')
      assert.equal(terminal.steps[1].name, 'test')
      if (mode === 'transient') {
        assert.equal(kills, 0)
        assert.equal(terminal.steps[1].state, 'failed')
      } else {
        assert.ok(kills >= 1)
        assert.equal(terminal.steps[1].state, 'running')
      }
    } finally {
      clearTimeout(timer)
      delete require.cache[file]
      cp.spawn = originals.spawn
      cp.execFile = originals.execFile
      for (const n of ['sails', 'App', 'CiPolicy', 'CiRun', 'Deployment']) {
        if (originals[n] === undefined) delete global[n]
        else global[n] = originals[n]
      }
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}
