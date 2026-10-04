const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const {
  requireCI,
  childEnvironment,
  LIMITS,
  PIN,
  residentData,
  assertLoopback
} = require('./native-config.cjs')
const {
  fixtureDependencies,
  prepareDependencies,
  verifyDependencies
} = require('./dependencies.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(read, accept, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  let last
  do {
    try {
      const value = await read()
      if (accept(value)) return value
    } catch (error) {
      if (error.fixtureFatal) throw error
      last = error
    }
    await sleep(50)
  } while (Date.now() < deadline)
  throw new Error(
    `Timed out: ${label}${last ? ` (${last.code || last.name})` : ''}`
  )
}

function prepareWeb({ appRoot, repo, source, packed }) {
  fs.cpSync(path.join(__dirname, 'native-web'), appRoot, { recursive: true })
  for (const relative of [
    'api/helpers/build-index-report.js',
    'scripts/rebuild-search-index.js',
    'scripts/typed-report.js',
    'scripts/throwing-job.js'
  ]) {
    const destination = path.join(appRoot, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(__dirname, 'app', relative), destination)
  }
  fs.writeFileSync(
    path.join(appRoot, 'package.json'),
    // The installed Sails CLI indexes packageJson.scripts before resolving a
    // source script. Keep the dictionary present without shadowing any job.
    JSON.stringify({
      private: true,
      scripts: {},
      dependencies: fixtureDependencies
    })
  )
  const layout = {
    appRoot,
    dependencies: fs.realpathSync(path.join(repo, 'node_modules')),
    questRoot: packed ? packed.questRoot : source.root,
    slipwayRoot: packed
      ? packed.slipwayRoot
      : fs.realpathSync(path.join(repo, 'packages/hook')),
    packed
  }
  prepareDependencies(layout)
  verifyDependencies(layout)
  return layout
}

function ticks(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
  return stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/)[19]
}

async function createNativeFixture(options = {}) {
  requireCI(options.env || process.env) // Gate precedes filesystem/process work.
  const { upstreamSource } = require('./docker.cjs')
  const source = await upstreamSource(options.env || process.env)
  assert.equal(source.sha, PIN)
  const { packedSource, proofFor } = require('./packed.cjs')
  const packed = await packedSource(options.env || process.env, source)
  const repo = path.resolve(__dirname, '../../..')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-native-restart-'))
  fs.chmodSync(root, 0o700)
  const contextFile = path.join(root, 'context.json')
  const evidenceFile = path.join(root, 'evidence.jsonl')
  const appRoot = path.join(root, 'web')
  for (const directory of ['home', 'tmp'])
    fs.mkdirSync(path.join(root, directory), { mode: 0o700 })
  const context = {
    root,
    repo,
    generation: 'A',
    port: 0,
    slug: `quest-native-${randomUUID()}`
  }
  fs.writeFileSync(contextFile, JSON.stringify(context), { mode: 0o600 })
  fs.writeFileSync(evidenceFile, '', { mode: 0o600 })
  const handles = []
  let outputBytes = 0,
    ipcBytes = 0,
    output = '',
    failure,
    closing = false,
    monitor
  const registry = new Map()
  const check = () => {
    if (failure) throw failure
  }
  const readContext = () => JSON.parse(fs.readFileSync(contextFile, 'utf8'))
  const redact = (text) => {
    let value = String(text)
    const ctx = readContext()
    for (const secret of [ctx.telemetryToken, ctx.authHeaders?.authorization])
      if (secret) value = value.split(secret).join('[private fixture token]')
    return value.replace(/(?:stk_|sl_)[a-f0-9]{48}/g, '[private fixture token]')
  }
  const evidence = () => {
    check()
    const raw = fs.readFileSync(evidenceFile, 'utf8')
    assert.ok(Buffer.byteLength(raw) <= LIMITS.bytes)
    return raw
      .split('\n')
      .slice(0, -1)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }
  const fail = (error) => {
    if (failure) return
    failure = Object.assign(error, { fixtureFatal: true })
    for (const handle of handles) {
      if (!handle.exited) {
        try {
          process.kill(-handle.child.pid, 'SIGKILL')
        } catch (problem) {
          if (problem.code !== 'ESRCH') throw problem
        }
      }
    }
  }
  function launch(script, cwd, values = {}) {
    check()
    const child = spawn(process.execPath, [script], {
      cwd,
      env: childEnvironment({
        root,
        context: contextFile,
        evidence: evidenceFile,
        ...values
      }),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    const handle = {
      child,
      pid: child.pid,
      pending: new Map(),
      next: 0,
      exited: false,
      target: values.appId ? values : null
    }
    handles.push(handle)
    try {
      handle.startTicks = ticks(child.pid)
    } catch {}
    let readyResolve, readyReject
    handle.ready = new Promise((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    handle.exit = new Promise((resolve) =>
      child.once('exit', (code, signal) => {
        handle.exited = true
        handle.outcome = { code, signal }
        readyReject(
          new Error(
            `Native ${path.basename(script)} exited before readiness (${
              code || signal
            })`
          )
        )
        for (const pending of handle.pending.values())
          pending.reject(new Error('Owned native process exited'))
        handle.pending.clear()
        resolve(handle.outcome)
      })
    )
    child.once('error', (error) => {
      readyReject(error)
      fail(error)
    })
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        outputBytes += chunk.length
        output += chunk.toString('utf8')
        if (outputBytes > LIMITS.bytes)
          fail(new Error('Native child output exceeds 2 MiB'))
      })
    child.on('message', (message) => {
      ipcBytes += Buffer.byteLength(JSON.stringify(message))
      if (ipcBytes > LIMITS.bytes)
        return fail(new Error('Native IPC output exceeds 2 MiB'))
      if (message.type === 'ready') {
        handle.identity = message
        readyResolve(message)
        return
      }
      const pending = handle.pending.get(message.id)
      if (!pending) return fail(new Error('Unexpected native IPC response'))
      handle.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.value)
    })
    handle.call = (command, values = {}) => {
      check()
      return new Promise((resolve, reject) => {
        const id = ++handle.next
        const timer = setTimeout(() => {
          handle.pending.delete(id)
          reject(new Error('Native dashboard IPC timed out'))
        }, 15000)
        handle.pending.set(id, {
          resolve(value) {
            clearTimeout(timer)
            resolve(value)
          },
          reject(error) {
            clearTimeout(timer)
            reject(error)
          }
        })
        child.send({ id, command, ...values }, (error) => {
          if (error) {
            clearTimeout(timer)
            handle.pending.delete(id)
            reject(error)
          }
        })
      })
    }
    handle.deadline = setTimeout(
      () => fail(new Error('Native child exceeded 180 seconds')),
      LIMITS.lifetimeMs
    )
    return handle
  }

  function rememberRegistry(handle, target) {
    const stem = `${target.appId}-${target.deploymentId}-${handle.pid}`
    for (const filename of [
      `/tmp/slipway-quest-runtimes/${stem}.json`,
      `/tmp/slipway-quest-runtimes/${stem}.sock`,
      `/tmp/slipway-helm-runtimes/${stem}.json`
    ]) {
      if (!fs.existsSync(filename)) continue
      const stat = fs.lstatSync(filename)
      assert.equal(stat.uid, process.getuid())
      assert.equal(stat.mode & 0o077, 0)
      if (filename.endsWith('.json')) {
        const identity = JSON.parse(fs.readFileSync(filename, 'utf8'))
        assert.equal(identity.pid, handle.pid)
        assert.equal(identity.startTicks, handle.startTicks)
      } else assert.ok(stat.isSocket())
      const owned = registry.get(filename)
      if (owned) {
        assert.equal(stat.dev, owned.dev)
        assert.equal(stat.ino, owned.ino)
      } else registry.set(filename, { dev: stat.dev, ino: stat.ino })
    }
  }

  async function stop(handle, signal = 'SIGTERM') {
    // Never signal a group number again after confirming its disappearance;
    // the kernel may reuse that number while the other generation is running.
    if (handle.stopped) return handle.outcome
    clearTimeout(handle.deadline)
    if (!handle.exited) {
      assert.equal(
        ticks(handle.pid),
        handle.startTicks,
        'Signal only the owned process generation'
      )
      process.kill(-handle.pid, signal)
    }
    const ended = await Promise.race([
      handle.exit.then(() => true),
      sleep(5000).then(() => false)
    ])
    if (!ended) {
      try {
        process.kill(-handle.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
      await Promise.race([
        handle.exit,
        sleep(5000).then(() => {
          throw new Error('Owned process exit was not confirmed')
        })
      ])
    }
    // An owned leader can exit before its CLI descendants. Kill only this
    // previously created group, and require the entire group to disappear.
    try {
      process.kill(-handle.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    await waitFor(
      () => {
        try {
          process.kill(-handle.pid, 0)
          return false
        } catch (error) {
          if (error.code === 'ESRCH') return true
          throw error
        }
      },
      Boolean,
      'owned native process-group cleanup',
      5000
    )
    handle.stopped = true
    if (handle.child.connected) handle.child.disconnect()
    return handle.outcome
  }

  const fixture = {
    source,
    packedProof: proofFor(packed),
    root,
    appRoot,
    handles,
    registry,
    evidence,
    check,
    async dashboard(generation) {
      const ctx = readContext()
      fs.writeFileSync(contextFile, JSON.stringify({ ...ctx, generation }), {
        mode: 0o600
      })
      const handle = launch(path.join(__dirname, 'native-dashboard.cjs'), repo)
      await waitFor(
        () => Promise.race([handle.ready, sleep(50).then(() => null)]),
        Boolean,
        `dashboard ${generation} lift`,
        40000
      )
      check()
      return handle
    },
    async web() {
      const ctx = readContext()
      assert.equal(
        assertLoopback(ctx.telemetryUrl).pathname,
        '/api/v1/telemetry/ingest'
      )
      const handle = launch(path.join(appRoot, 'app.js'), appRoot, {
        appId: ctx.appId,
        deploymentId: ctx.deploymentId
      })
      await waitFor(
        () => Promise.race([handle.ready, sleep(50).then(() => null)]),
        Boolean,
        'resident web app lift',
        30000
      )
      const stem = `${ctx.appId}-${ctx.deploymentId}-${handle.pid}`
      await waitFor(
        () => fs.existsSync(`/tmp/slipway-quest-runtimes/${stem}.json`),
        Boolean,
        'real resident registration'
      )
      rememberRegistry(handle, ctx)
      assert.equal(registry.size, 3)
      return handle
    },
    async call(command, values = {}) {
      check()
      const ctx = readContext()
      const { residentRequest } = require(path.join(
        repo,
        'api/lib/quest-runtime-client'
      ))
      return residentData(
        await residentRequest({
          command,
          appId: String(ctx.appId),
          deploymentId: String(ctx.deploymentId),
          ...values
        })
      )
    },
    async killDashboard(handle) {
      const outcome = await stop(handle, 'SIGKILL')
      assert.equal(outcome.signal, 'SIGKILL')
      return outcome
    },
    async waitFor(read, accept, label, timeout) {
      return waitFor(
        async () => {
          check()
          return read()
        },
        accept,
        label,
        timeout
      )
    },
    summary() {
      return {
        outputBytes,
        ipcBytes,
        evidenceBytes: fs.statSync(evidenceFile).size
      }
    },
    diagnostics() {
      return redact(output.slice(-12000))
    },
    async close() {
      if (closing) throw new Error('Native cleanup called twice')
      closing = true
      clearInterval(monitor)
      const errors = []
      const ctx = readContext()
      for (const handle of handles.filter((item) => item.target)) {
        try {
          rememberRegistry(handle, ctx)
        } catch (error) {
          errors.push(error)
        }
      }
      for (const handle of [...handles].reverse()) {
        try {
          await stop(handle)
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          'Native process cleanup was not confirmed'
        )
      for (const [filename, owned] of registry) {
        if (fs.existsSync(filename)) {
          const current = fs.lstatSync(filename)
          assert.equal(current.dev, owned.dev)
          assert.equal(current.ino, owned.ino)
          fs.unlinkSync(filename)
        }
        assert.equal(fs.existsSync(filename), false)
      }
      fs.rmSync(root, { recursive: true })
      assert.equal(
        fs.existsSync(root),
        false,
        'Remove unique SQLite/WAL/context/app/evidence state'
      )
      return {
        processesExited: handles.length,
        ownedRegistryEntriesRemoved: registry.size,
        privateDirectoryRemoved: true
      }
    }
  }
  try {
    prepareWeb({ appRoot, repo, source, packed })
    monitor = setInterval(() => {
      try {
        const events = evidence()
        assert.ok(
          events.filter((event) => event.kind === 'quest:start').length <=
            LIMITS.starts,
          'Native hard start cap'
        )
        assert.ok(
          events.filter((event) => event.kind === 'sails-load').length <=
            LIMITS.loads,
          'Native hard load cap'
        )
      } catch (error) {
        fail(error)
      }
    }, 100)
    return fixture
  } catch (error) {
    await fixture.close()
    throw error
  }
}

module.exports = { createNativeFixture, prepareWeb, waitFor }
