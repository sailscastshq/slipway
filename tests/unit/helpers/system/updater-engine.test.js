const { test } = require('sounding')
const assert = require('node:assert/strict')
const { createUpdater, PREFIX } = require('../../../../bin/slipway-updater.cjs')
function fixture({
  failSnapshot = false,
  preflightNormal = false,
  badTarget = false,
  partialStart = false,
  wrongChecksum = false,
  snapshotDeadline = false,
  cleanupFails = false,
  withProgress = false
} = {}) {
  let now = 0,
    counter = 0
  const calls = [],
    logs = [],
    items = new Map()
  const source = {
    Id: 'original-id',
    Image: 'old-image',
    Name: '/slipway',
    State: { Running: true, Status: 'running' },
    Mounts: [
      { Type: 'volume', Name: 'private-db', Destination: '/app/db', RW: true },
      {
        Type: 'bind',
        Source: '/var/slipway/apps',
        Destination: '/var/slipway/apps',
        RW: true
      },
      {
        Type: 'volume',
        Name: 'readonly-data',
        Destination: '/readonly',
        RW: false
      }
    ],
    NetworkSettings: { Networks: { slipway: {} } },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 2147483648,
      NanoCpus: 2000000000,
      PortBindings: { '1337/tcp': [{ HostIp: '127.0.0.1', HostPort: '1337' }] }
    },
    Config: {
      Env: [
        'NODE_ENV=production',
        'PORT=1337',
        'SLIPWAY_APP_PORT_HOST=127.0.0.1',
        'DATA_ENCRYPTION_KEY=fixture-secret-never-log'
      ],
      Labels: { 'custom.label': 'keep-me' }
    }
  }
  items.set(source.Id, source)
  const find = (value) =>
    items.get(value) || [...items.values()].find((x) => x.Name === '/' + value)
  const labels = (args) =>
    Object.fromEntries(
      args.flatMap((x, i) =>
        x === '--label' || x === '-l'
          ? [args[i + 1].split(/=(.*)/s).slice(0, 2)]
          : []
      )
    )
  const healthy = (version) => ({
    status: 'ok',
    version,
    releaseMigrations: {
      ready: true,
      version: '0.0.88',
      checksum: version === '0.0.121' ? 'old-checksum' : 'target-checksum'
    }
  })
  const docker = async (args, options = {}) => {
    calls.push([...args])
    if (args[0] === 'image') return JSON.stringify([{ Id: 'target-image' }])
    if (args[0] === 'inspect') {
      const i = find(args[1])
      if (!i) throw Error('No such container')
      return JSON.stringify([i])
    }
    if (args[0] === 'logs') return logs.join('\n')
    if (args[0] === 'create') {
      const name = args[args.indexOf('--name') + 1]
      if (find(name)) throw Error('Conflict: name already in use')
      const id = 'job-' + ++counter
      items.set(id, {
        Id: id,
        Name: '/' + name,
        State: { Running: false, Status: 'created' },
        Config: { Labels: labels(args) }
      })
      return id
    }
    if (args[0] === 'start') {
      find(args[1]).State = { Running: true, Status: 'running' }
      return args[1]
    }
    if (args[0] === 'stop') {
      find(args[1]).State = { Running: false, Status: 'exited' }
      return args[1]
    }
    if (args[0] === 'rename') {
      find(args[1]).Name = '/' + args[2]
      return ''
    }
    if (args[0] === 'rm') {
      const i = find(args.at(-1))
      if (cleanupFails && i?.Id === 'snapshot-helper')
        throw Error('Fixture cleanup unavailable')
      if (i) items.delete(i.Id)
      return ''
    }
    if (args[0] === 'network') return ''
    if (args[0] === 'run' && args.includes('/app/bin/slipway-database.cjs')) {
      if (withProgress)
        options.onBackupProgress({
          stage: 'verifying',
          database: 'observability.db'
        })
      if (snapshotDeadline) {
        items.set('snapshot-helper', {
          Id: 'snapshot-helper',
          Name: '/' + args[args.indexOf('--name') + 1],
          State: { Running: true },
          Config: { Labels: labels(args) }
        })
        throw Error('Snapshot command deadline exceeded')
      }
      return JSON.stringify({
        archive: '/app/db/system-backups/verified/system.tar.gz',
        manifest: {
          databases: [
            'app.db',
            'observability.db',
            'analytics.db',
            'stash.db'
          ].map((file) => ({
            file,
            integrity: failSnapshot ? 'failed' : 'ok',
            foreignKeys: 'ok'
          }))
        }
      })
    }
    if (args[0] === 'run' && args.some((x) => x.includes('statfsSync')))
      return JSON.stringify({ capacityVerified: true })
    if (args[0] === 'run' && args.includes('--rm'))
      return JSON.stringify({ version: '0.0.122', checksum: 'target-checksum' })
    if (args[0] === 'run') {
      const name = args[args.indexOf('--name') + 1],
        id = 'candidate-' + ++counter
      items.set(id, {
        Id: id,
        Image: 'target-image',
        Name: '/' + name,
        State: { Running: true, Status: 'running' },
        Config: { Labels: labels(args) }
      })
      if (partialStart && name === 'slipway') {
        find(id).State = { Running: false, Status: 'created' }
        throw Error('Candidate could not bind the dashboard port')
      }
      return id
    }
    if (args[0] === 'exec') {
      const i = find(args[1])
      if (!i) throw Error('No such container')
      if (i.Name.includes('-next-'))
        return JSON.stringify(
          preflightNormal
            ? healthy('0.0.122')
            : {
                mode: 'preflight',
                normalStartupReady: false,
                version: '0.0.88'
              }
        )
      if (i.Id === source.Id) return JSON.stringify(healthy('0.0.121'))
      return JSON.stringify(
        badTarget
          ? { ...healthy('0.0.122'), mode: 'preflight' }
          : {
              ...healthy('0.0.122'),
              ...(wrongChecksum
                ? {
                    releaseMigrations: {
                      ready: true,
                      checksum: 'wrong-checksum'
                    }
                  }
                : {})
            }
      )
    }
    throw Error('Unexpected fixture command: ' + args[0])
  }
  const engine = createUpdater({
    docker,
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    emit: (line) => logs.push(line)
  })
  const options = {
    targetImage: 'example/slipway:0.0.122',
    targetVersion: '0.0.122'
  }
  const run = async () => {
    const admitted = await engine.start(options)
    const result = await engine.run({
      ...options,
      operationId: admitted.operationId,
      sourceId: source.Id,
      skipPull: true
    })
    find('slipway-updater').State = { Running: false, Status: 'exited' }
    return result
  }
  return {
    engine,
    secondEngine: createUpdater({ docker, now: () => now }),
    options,
    run,
    calls,
    logs,
    items,
    find,
    source,
    healthy
  }
}
test('terminal and UI concurrent admission share one detached operation', async () => {
  const f = fixture()
  const results = await Promise.all([
    f.engine.start(f.options),
    f.secondEngine.start(f.options)
  ])
  assert.equal(results[0].operationId, results[1].operationId)
  assert.equal(f.calls.filter((x) => x[0] === 'create').length, 2)
  assert.equal(f.calls.filter((x) => x[0] === 'start').length, 1)
  assert.equal(
    f.calls.some(
      (x) => x.includes('/etc/slipway/.env') || x.includes('slipway-proxy')
    ),
    false
  )
})
test('the engine verifies backups and copy preflight before stopping the old writer, preserves config and verifies normal target receipts', async () => {
  const f = fixture()
  const result = await f.run()
  assert.equal(result.phase, 'success')
  const start = f.calls.find(
    (x) =>
      x[0] === 'run' &&
      x.includes('--name') &&
      x[x.indexOf('--name') + 1] === 'slipway'
  )
  for (const value of [
    '127.0.0.1:1337:1337',
    'readonly-data:/readonly:ro',
    '2147483648',
    '2',
    'unless-stopped',
    'DATA_ENCRYPTION_KEY=fixture-secret-never-log',
    'custom.label=keep-me'
  ])
    assert.ok(start.includes(value), value)
  const preflight = f.calls.find(
    (x) => x[0] === 'run' && x.some((v) => v.startsWith('slipway-next-'))
  )
  assert.equal(preflight.includes('-p'), false)
  assert.ok(
    f.calls.findIndex((x) => x.includes('/app/bin/slipway-database.cjs')) <
      f.calls.findIndex((x) => x[0] === 'stop')
  )
  assert.ok(f.calls.findIndex((x) => x[0] === 'stop') < f.calls.indexOf(start))
  assert.equal(f.logs.join('\n').includes('fixture-secret-never-log'), false)
  assert.equal((await f.engine.status()).phase, 'success')
})
for (const scenario of [
  'snapshot',
  'preflight',
  'readiness',
  'partial-start',
  'checksum'
])
  test(`shared updater handles ${scenario} without false success or unsafe retry`, async () => {
    const f = fixture({
      failSnapshot: scenario === 'snapshot',
      preflightNormal: scenario === 'preflight',
      badTarget: scenario === 'readiness',
      partialStart: scenario === 'partial-start',
      wrongChecksum: scenario === 'checksum'
    })
    const result = await f.run()
    assert.equal(
      result.phase,
      ['snapshot', 'preflight'].includes(scenario) ? 'failed' : 'rolled-back'
    )
    assert.equal(result.canRetry, true)
    assert.equal(f.find('slipway').Id, f.source.Id)
    assert.equal(f.source.State.Running, true)
    if (['snapshot', 'preflight'].includes(scenario))
      assert.equal(
        f.calls.some((x) => x[0] === 'stop'),
        false
      )
    assert.equal(
      f.calls.some((x) => x[0] === 'cp'),
      false,
      'never overwrite committed database migrations during rollback'
    )
    assert.equal(
      f.logs.some(
        (line) =>
          line.startsWith(PREFIX) &&
          JSON.parse(line.slice(PREFIX.length)).phase === 'success'
      ),
      false
    )
  })
test('a running updater plus healthy old version remains progress, not rollback', async () => {
  const f = fixture()
  const op = await f.engine.start(f.options)
  f.logs.push(PREFIX + JSON.stringify({ ...op, phase: 'validating' }))
  assert.equal((await f.engine.status()).phase, 'validating')
})
test('a dead updater reconciles only exact ready target identity or an unchanged healthy original', async () => {
  const f = fixture()
  const op = await f.engine.start(f.options)
  f.find('slipway-updater').State = { Running: false, Status: 'exited' }
  f.logs.push(
    PREFIX +
      JSON.stringify({
        ...op,
        phase: 'waiting',
        targetImageId: 'different-image',
        checksum: 'target-checksum'
      })
  )
  const old = await f.engine.status()
  assert.equal(old.phase, 'failed')
  assert.equal(old.canRetry, true)
  f.items.delete(f.source.Id)
  f.items.set('unexpected', {
    Id: 'unexpected',
    Name: '/slipway',
    Image: 'wrong-image',
    State: { Running: true }
  })
  assert.equal((await f.engine.status()).phase, 'interrupted')
})

test('custom host networking fails before replacing any container', async () => {
  const f = fixture()
  f.source.HostConfig.NetworkMode = 'host'
  const result = await f.run()
  assert.equal(result.phase, 'failed')
  assert.equal(
    f.calls.some((x) => x[0] === 'stop'),
    false
  )
})

test('a dead updater with a retained snapshot helper cannot admit a second writer', async () => {
  const f = fixture()
  const op = await f.engine.start(f.options)
  f.find('slipway-updater').State = { Running: false, Status: 'exited' }
  f.items.set('helper', {
    Id: 'helper',
    Name: '/slipway-snapshot-' + op.operationId.slice(0, 8),
    State: { Running: true }
  })
  const result = await f.engine.status()
  assert.equal(result.phase, 'interrupted')
  assert.equal(result.canRetry, false)
})

test('an abandoned creation reconciles the original before admitting a retry', async () => {
  const f = fixture()
  const op = await f.engine.start(f.options)
  const job = f.find('slipway-updater')
  job.State = { Running: false, Status: 'created' }
  job.Config.Labels['slipway.updater.created'] = '-60000'
  const status = await f.engine.status()
  assert.equal(status.phase, 'failed')
  assert.equal(status.canRetry, true)
  const replacement = await f.engine.start(f.options)
  assert.notEqual(replacement.operationId, op.operationId)
  assert.equal(f.source.State.Running, true)
})

for (const cleanupFails of [false, true])
  test(`snapshot deadline keeps old writer running and retry ${
    cleanupFails
      ? 'blocked on unknown cleanup'
      : 'safe only after owned cleanup'
  }`, async () => {
    const f = fixture({ snapshotDeadline: true, cleanupFails })
    f.items.set('unrelated', {
      Id: 'unrelated',
      Name: '/unrelated',
      State: { Running: true },
      Config: { Labels: {} }
    })
    const result = await f.run()
    assert.equal(result.phase, 'failed')
    assert.equal(result.canRetry, !cleanupFails)
    assert.equal(f.source.State.Running, true)
    assert.equal(
      f.calls.some((args) => args[0] === 'stop' || args[0] === 'rename'),
      false
    )
    assert.equal(f.items.has('unrelated'), true)
    assert.equal(f.items.has('snapshot-helper'), cleanupFails)
  })
test('native backup progress reaches the durable operation and maintenance helpers do not inherit web health', async () => {
  const f = fixture({ withProgress: true })
  await f.run()
  const events = f.logs
    .filter((line) => line.startsWith(PREFIX))
    .map((line) => JSON.parse(line.slice(PREFIX.length)))
  assert.ok(
    events.some(
      (event) =>
        event.phase === 'backing-up' &&
        event.detail ===
          'Checking integrity and foreign keys for observability.db'
    )
  )
  const helpers = f.calls.filter(
    (args) =>
      args[0] === 'run' &&
      args.includes('--name') &&
      args[args.indexOf('--name') + 1].includes('-snapshot-')
  )
  assert.ok(helpers.length >= 3)
  for (const args of helpers)
    assert.ok(args.includes('--init') && args.includes('--no-healthcheck'))
})
test('backup progress rejects untrusted fields and distinguishes copy, verification, hashing and archive input', () => {
  const {
    parseBackupProgress,
    describeBackupProgress,
    BACKUP_PROGRESS_PREFIX
  } = require('../../../../bin/slipway-updater.cjs')
  const parse = (data) =>
    parseBackupProgress(BACKUP_PROGRESS_PREFIX + JSON.stringify(data))
  assert.equal(parse({ stage: 'copying', database: 'secret/path' }), null)
  assert.equal(parse({ stage: 'success' }), null)
  assert.equal(
    parseBackupProgress(BACKUP_PROGRESS_PREFIX + 'x'.repeat(5000)),
    null
  )
  assert.deepEqual(
    parse({
      stage: 'copying',
      database: 'app.db',
      copiedPages: 5,
      totalPages: 10,
      secret: 'never-forward'
    }),
    { stage: 'copying', database: 'app.db', copiedPages: 5, totalPages: 10 }
  )
  assert.match(
    describeBackupProgress(
      parse({
        stage: 'copying',
        database: 'app.db',
        copiedPages: 5,
        totalPages: 10
      })
    ),
    /5\/10 pages/
  )
  assert.match(
    describeBackupProgress(
      parse({ stage: 'archiving', bytes: 1024 ** 2, totalBytes: 2 * 1024 ** 2 })
    ),
    /1\/2 MiB read/
  )
})
test('an external command that ignores TERM still hits the hard client deadline', async () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-hard-deadline-'))
  const binary = path.join(dir, 'docker-fixture'),
    ready = binary + '.ready'
  fs.writeFileSync(
    binary,
    '#!/bin/sh\ntrap "" TERM\n: > "$0.ready"\nwhile :; do sleep 1; done\n',
    { mode: 0o755 }
  )
  const started = Date.now()
  try {
    await assert.rejects(
      createUpdater({ binary, commandTimeoutMs: 750 }).status(),
      (error) => error.code === 'UPDATER_COMMAND_DEADLINE'
    )
    assert.ok(Date.now() - started < 5000)
    assert.equal(
      fs.existsSync(ready),
      true,
      'fixture installed its TERM handler before deadline'
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
