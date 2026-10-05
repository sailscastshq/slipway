const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { once } = require('node:events')
const Database = require('better-sqlite3')
const { runBounded } = require('../../api/lib/upgrade-process')
const { processIdentity } = require('../../api/lib/upgrade-writer-observer')
const { fixture, image } = require('./release-fixtures.cjs')
const enabled =
  process.platform === 'linux' && process.env.SLIPWAY_WRITER_FIXTURE === '1'
function docker(...args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30000
  }).trim()
}
async function ready(filename) {
  const end = Date.now() + 10000
  while (!fs.existsSync(filename)) {
    if (Date.now() >= end) throw new Error('Disposable writer did not start')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
test(
  'real Linux host and Docker writers must stop, disable restart, and remain observable',
  { skip: !enabled, timeout: 120000 },
  async () => {
    assert.equal(
      process.getuid(),
      0,
      'Use the privileged disposable CI host launcher'
    )
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-writers-'))
    const filename = path.join(directory, 'app.db')
    const marker = path.join(directory, 'host-ready')
    const database = new Database(filename)
    database.exec('CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT)')
    database.close()
    const controller = processIdentity(process.pid)
    const hostPidNamespace = fs.readlinkSync('/proc/self/ns/pid')
    const input = {
      databases: [
        { datastore: 'default', path: filename, databaseKey: 'fixture:default' }
      ],
      controller,
      hostPidNamespace
    }
    const observe = () =>
      runBounded({ operation: 'observeWriters', input, timeoutMs: 20000 })
    let writer
    const containers = []
    try {
      const clear = await observe()
      assert.equal(clear.writersStopped, true)
      assert.equal(clear.exclusiveController, undefined)
      writer = spawn(
        process.execPath,
        [
          path.join(__dirname, 'fixtures/database-writer.cjs'),
          filename,
          marker
        ],
        { stdio: 'ignore' }
      )
      await ready(marker)
      await assert.rejects(observe(), { code: 'upgradeWorkerFailed' })
      const exited = once(writer, 'exit')
      writer.kill('SIGKILL')
      await exited
      writer = null
      assert.equal((await observe()).writersStopped, true)
      // A replacement process with a different native identity must block too.
      fs.unlinkSync(marker)
      writer = spawn(
        process.execPath,
        [
          path.join(__dirname, 'fixtures/database-writer.cjs'),
          filename,
          marker
        ],
        { stdio: 'ignore' }
      )
      await ready(marker)
      await assert.rejects(observe(), { code: 'upgradeWorkerFailed' })
      const replaced = once(writer, 'exit')
      writer.kill('SIGKILL')
      await replaced
      writer = null
      // Hard-link aliases and sidecar-only handles are identified by inode.
      const alias = path.join(directory, 'database-alias')
      fs.linkSync(filename, alias)
      for (const held of [alias, filename + '-wal']) {
        assert.ok(fs.existsSync(held))
        fs.unlinkSync(marker)
        writer = spawn(
          process.execPath,
          [path.join(__dirname, 'fixtures/held-file.cjs'), held, marker],
          { stdio: 'ignore' }
        )
        await ready(marker)
        await assert.rejects(observe(), { code: 'upgradeWorkerFailed' })
        const released = once(writer, 'exit')
        writer.kill('SIGKILL')
        await released
        writer = null
      }
      const id = docker(
        'run',
        '-d',
        '--restart=always',
        '--mount',
        `type=bind,src=${directory},dst=/fixture`,
        'node:22-bookworm-slim',
        'node',
        '-e',
        'const fs=require("fs");const fd=fs.openSync("/fixture/app.db","r+");setInterval(()=>fs.fsyncSync(fd),100)'
      )
      containers.push(id)
      await assert.rejects(observe(), { code: 'upgradeWorkerFailed' })
      docker('pause', id)
      await assert.rejects(observe(), { code: 'upgradeWorkerFailed' })
      docker('unpause', id)
      docker('stop', '-t', '1', id)
      // Stopping alone does not disable daemon restart after a host reboot.
      await assert.rejects(observe(), { code: 'upgradeWorkerFailed' })
      docker('update', '--restart=no', id)
      const stopped = await observe()
      assert.deepEqual(stopped.stoppedContainers, [id])
      // Unknown new writer containers cannot hide behind the earlier receipt.
      const replacement = docker(
        'run',
        '-d',
        '--mount',
        `type=bind,src=${directory},dst=/fixture`,
        'node:22-bookworm-slim',
        'node',
        '-e',
        'setInterval(()=>{},100)'
      )
      containers.push(replacement)
      await assert.rejects(observe(), { code: 'upgradeWorkerFailed' })
      docker('stop', '-t', '1', replacement)
      assert.equal((await observe()).writersStopped, true)
      await assert.rejects(
        runBounded({
          operation: 'observeWriters',
          input: {
            ...input,
            controller: { ...controller, start: 'wrong-start' }
          },
          timeoutMs: 20000
        }),
        { code: 'upgradeWorkerFailed' }
      )
      await assert.rejects(
        runBounded({
          operation: 'observeWriters',
          input: { ...input, hostPidNamespace: 'wrong-namespace' },
          timeoutMs: 20000
        }),
        { code: 'upgradeWorkerFailed' }
      )
      // Exercise real observations before backup and each live COMMIT. The
      // fixture alone supplies exclusive launch ownership; this is not a
      // production control-plane exclusion adapter.
      await fixture(null, async ({ services, directory: freshDirectory }) => {
        const bounded = (operation, value, extra = {}) =>
          runBounded({ operation, input: value, timeoutMs: 20000, ...extra })
        const identity = await bounded('plan', {
          services,
          image,
          instanceId: 'fixture-instance',
          mode: 'fresh'
        })
        const verifyFence = async (...args) => {
          const [targets, context] = args
          const { workerPid } = args.at(-1)
          const observed = await bounded('observeWriters', {
            databases: targets,
            controller,
            worker: processIdentity(workerPid),
            hostPidNamespace
          })
          assert.equal(observed.exclusiveController, undefined)
          return {
            ...observed,
            id: 'disposable-linux-fence',
            exclusiveController: true,
            controllerOwner: context?.owner
          }
        }
        const backupSet = await bounded(
          'backup',
          {
            databases: services,
            directory: freshDirectory,
            maxBytes: 50 * 1024 * 1024,
            reserveBytes: 0
          },
          { verifyFence }
        )
        const preflight = await bounded('preflight', { identity, backupSet })
        const handle = await bounded('prepare', {
          identity,
          backupSet,
          preflight,
          databases: services,
          directory: freshDirectory,
          instanceId: 'fixture-instance'
        })
        const result = await bounded(
          'run',
          {
            filename: handle.filename,
            owner: 'linux-fixture-controller',
            expectedInstanceId: 'fixture-instance',
            expectedManifestHash: identity.hash
          },
          { verifyFence, audit: async () => {} }
        )
        assert.equal(result.phase, 'completed')
        assert.equal(result.applied.length, 4)
      })
    } finally {
      if (writer) {
        const exited = once(writer, 'exit')
        writer.kill('SIGKILL')
        await exited
      }
      for (const id of containers) docker('rm', '-f', id)
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
