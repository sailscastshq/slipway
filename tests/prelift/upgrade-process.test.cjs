const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const {
  createSupervisor,
  runBounded
} = require('../../api/lib/upgrade-process')
const { fixture, image } = require('./release-fixtures.cjs')
const supervise = createSupervisor(
  path.join(__dirname, 'fixtures/blocked-upgrade-worker.cjs')
)
for (const commit of [false, true]) {
  test(`hard deadline reaps blocked native worker and preserves ${
    commit ? 'committed' : 'rolled back'
  } DDL`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-bound-'))
    const filename = path.join(directory, 'app.db')
    const started = path.join(directory, 'started')
    const db = new Database(filename)
    db.exec('CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT)')
    db.close()
    try {
      const start = Date.now()
      await assert.rejects(
        supervise({
          operation: 'fixture',
          input: { filename, started, commit },
          timeoutMs: 1000
        }),
        { code: 'upgradeWorkerTimeout' }
      )
      assert.ok(Date.now() - start < 5000)
      const pid = Number(fs.readFileSync(started, 'utf8'))
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
      const reopened = new Database(filename)
      assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok')
      assert.equal(
        reopened
          .pragma('table_info(notes)')
          .some((column) => column.name === 'added'),
        commit
      )
      reopened.exec('BEGIN IMMEDIATE; ROLLBACK')
      reopened.close()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}
test('fixed worker runs registered fresh plan without ORM or inherited credentials', async () => {
  await fixture(null, async ({ services }) => {
    const result = await runBounded({
      operation: 'plan',
      input: { services, image, instanceId: 'fixture-instance', mode: 'fresh' },
      timeoutMs: 10000
    })
    assert.equal(result.manifest.steps.length, 4)
    assert.equal(result.manifest.instanceId, 'fixture-instance')
  })
})
test('fixed worker rejects arbitrary operations with a bounded neutral error', async () => {
  await assert.rejects(
    runBounded({ operation: 'SQL secret-value', input: {}, timeoutMs: 10000 }),
    (error) =>
      error.code === 'upgradeWorkerFailed' &&
      !error.message.includes('secret-value')
  )
  await assert.rejects(
    runBounded({ operation: 'status', input: {}, timeoutMs: 0 }),
    { code: 'upgradeWorkerInput' }
  )
})
test('bounded fixed workers complete backup, clone preflight and live ledger protocol', async () => {
  await fixture(null, async ({ services, directory }) => {
    const bounded = (operation, input, extra = {}) =>
      runBounded({ operation, input, timeoutMs: 10000, ...extra })
    const identity = await bounded('plan', {
      services,
      image,
      instanceId: 'fixture-instance',
      mode: 'fresh'
    })
    const verifyFence = async (targets, context) => ({
      id: 'fixture-process-fence',
      writersStopped: true,
      databaseKeys: targets.map((target) => target.databaseKey),
      exclusiveController: true,
      controllerOwner: context?.owner
    })
    const backupSet = await bounded(
      'backup',
      {
        databases: services,
        directory,
        maxBytes: 50 * 1024 * 1024,
        reserveBytes: 0
      },
      { verifyFence }
    )
    const preflight = await bounded('preflight', { identity, backupSet })
    const handle = await bounded('prepare', {
      directory,
      identity,
      databases: services,
      backupSet,
      preflight,
      instanceId: 'fixture-instance'
    })
    const result = await bounded(
      'run',
      {
        filename: handle.filename,
        owner: 'fixture-process-owner',
        expectedInstanceId: 'fixture-instance',
        expectedManifestHash: identity.hash
      },
      { verifyFence, audit: async () => {} }
    )
    assert.equal(result.phase, 'completed')
    assert.equal(result.pending.length, 0)
    assert.deepEqual(
      await bounded('status', { filename: handle.filename }),
      result
    )
  })
})
test('output bounds and hung fence callbacks terminate and reap the owned worker', async () => {
  const superviseProtocol = createSupervisor(
    path.join(__dirname, 'fixtures/worker-protocol.cjs')
  )
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-protocol-'))
  try {
    for (const [mode, code] of [
      ['output', 'upgradeWorkerOutput'],
      ['callback', 'upgradeWorkerTimeout']
    ]) {
      const started = path.join(directory, mode)
      await assert.rejects(
        superviseProtocol({
          operation: 'fixture',
          input: { mode, started },
          timeoutMs: 500,
          verifyFence: () => new Promise(() => {})
        }),
        (error) =>
          error.code === code && !error.message.includes('fixture-secret')
      )
      assert.throws(() => process.kill(Number(fs.readFileSync(started)), 0), {
        code: 'ESRCH'
      })
    }
    const keys = await superviseProtocol({
      operation: 'fixture',
      input: { mode: 'env', started: path.join(directory, 'env') },
      timeoutMs: 1000
    })
    assert.ok(
      keys.every((key) =>
        ['PATH', 'TMPDIR', 'NODE_ENV', '__CF_USER_TEXT_ENCODING'].includes(key)
      )
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
test(
  'Linux guardian stops native work after its controlling process is killed',
  { skip: process.platform !== 'linux', timeout: 10000 },
  async () => {
    const { fork } = require('node:child_process')
    const { once } = require('node:events')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-orphan-'))
    const filename = path.join(directory, 'app.db')
    const started = path.join(directory, 'started')
    const db = new Database(filename)
    db.exec('CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT)')
    db.close()
    const parent = fork(
      path.join(__dirname, 'fixtures/supervisor-parent.cjs'),
      [],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
    )
    try {
      parent.send({ filename, started, commit: false })
      const deadline = Date.now() + 5000
      while (!fs.existsSync(started)) {
        assert.ok(Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const pid = Number(fs.readFileSync(started, 'utf8'))
      const stopped = once(parent, 'exit')
      parent.kill('SIGKILL')
      await stopped
      while (true) {
        try {
          const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
          if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')) break
        } catch (error) {
          if (error.code === 'ENOENT') break
          throw error
        }
        assert.ok(
          Date.now() < deadline,
          'Guardian must stop the orphaned native worker'
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const reopened = new Database(filename)
      assert.equal(
        reopened
          .pragma('table_info(notes)')
          .some((column) => column.name === 'added'),
        false
      )
      reopened.exec('BEGIN IMMEDIATE; ROLLBACK')
      reopened.close()
    } finally {
      parent.kill('SIGKILL')
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
