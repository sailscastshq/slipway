const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const run = require('../../../../api/helpers/build-cache-retention/run').fn
const getCapabilities =
  require('../../../../api/helpers/build-cache-retention/get-capabilities').fn
const getPolicy =
  require('../../../../api/helpers/build-cache-retention/get-policy').fn
const { parse } =
  require('../../../../api/helpers/build-cache-retention/get-inventory')._private
const guard = require('../../../../api/lib/image-operation-guard')
const script = require('../../../../scripts/retain-build-cache')
const cache = (extra = {}) => ({
  entries: 2731,
  active: 0,
  size: '113.4GB',
  reclaimable: '21.29GB (18%)',
  ...extra
})

async function fixture(t, config = {}) {
  const originals = {
    sails: global.sails,
    DeploymentJob: global.DeploymentJob,
    AuditLog: global.AuditLog
  }
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-cache-retention-')
  )
  await fs.mkdir(path.join(root, 'db'))
  const binary = path.join(root, 'docker')
  await fs.writeFile(
    binary,
    `#!${process.execPath}\nconst fs=require('node:fs');const p=require('node:path');const root=p.dirname(process.argv[1]);const args=process.argv.slice(2);fs.appendFileSync(p.join(root,'commands'),JSON.stringify(args)+'\\n');const mode=JSON.parse(fs.readFileSync(p.join(root,'mode.json'),'utf8'));if(args.includes('--help')){console.log(mode.help || (mode.unsupported?'  --all\\n  --force':'  --all\\n  --filter filter\\n  --keep-storage bytes\\n  --force'));}else if(mode.fail){process.exitCode=1;}else if(mode.timeout){setTimeout(()=>{},100000);}else{console.log('Total reclaimed space: 74.75GB');}\n`,
    { mode: 0o755 }
  )
  await fs.writeFile(path.join(root, 'mode.json'), '{}')
  const state = {
    inventories: [
      cache(),
      cache(),
      cache({ entries: 318, size: '38.7GB', reclaimable: '1.136GB (2%)' })
    ],
    disks: [
      { availableBytes: 8300000000, totalBytes: 301000000000 },
      { availableBytes: 30000000000, totalBytes: 301000000000 }
    ],
    jobs: 0,
    update: { phase: 'idle' },
    audits: [],
    writes: [],
    logs: []
  }
  global.sails = {
    config: {
      appPath: root,
      docker: { binaryPath: binary },
      buildCacheRetention: config
    },
    helpers: {
      buildCacheRetention: {
        getUpdateStatus: async () => state.update,
        getCapabilities,
        getPolicy,
        getInventory: async () =>
          structuredClone(state.inventories.shift() || cache())
      },
      lookout: { getDiskSpace: async () => state.disks.shift() },
      setting: {
        set: async (key, value) =>
          state.writes.push({ key, value: JSON.parse(value) })
      }
    },
    log: { info: (value) => state.logs.push(value) }
  }
  global.DeploymentJob = { count: async () => state.jobs }
  global.AuditLog = {
    create: async (value) => state.audits.push(structuredClone(value))
  }
  t.after(async () => {
    Object.assign(global, originals)
    await fs.rm(root, { recursive: true, force: true })
  })
  return {
    root,
    state,
    mode: async (value) =>
      fs.writeFile(path.join(root, 'mode.json'), JSON.stringify(value)),
    commands: async () => {
      try {
        return (await fs.readFile(path.join(root, 'commands'), 'utf8'))
          .trim()
          .split('\n')
          .map(JSON.parse)
      } catch (e) {
        if (e.code === 'ENOENT') return []
        throw e
      }
    }
  }
}

test('cache policy retains at least seven unused days and10GiB; schedule uses existing hourly Quest', async (t) => {
  await fixture(t)
  const policy = await getPolicy()
  assert.equal(policy.remove, true)
  assert.equal(policy.minimumUnusedHours, 168)
  assert.equal(policy.keepStorageBytes, 20 * 1024 ** 3)
  assert.equal(script.quest.cron, '17 * * * *')
  assert.equal(script.quest.withoutOverlapping, true)
  for (const [key, value] of [
    ['minimumUnusedHours', 167],
    ['keepStorageBytes', 1],
    ['maxRunMs', 600001]
  ]) {
    sails.config.buildCacheRetention = { [key]: value }
    await assert.rejects(getPolicy(), /Invalid build cache retention/)
  }
})

test('only bounded builder prune is invoked; Docker accounting and actual net availability stay separate', async (t) => {
  const { state, commands, root } = await fixture(t)
  const result = await run()
  assert.equal(result.status, 'complete')
  assert.equal(result.mode, 'remove')
  assert.equal(result.dockerReportedReclaimed, '74.75GB')
  assert.equal(result.filesystemAvailableDeltaBytes, 21700000000)
  assert.equal(result.cacheAfter.entries, 318)
  assert.deepEqual(await commands(), [
    ['builder', 'prune', '--help'],
    [
      'builder',
      'prune',
      '--all',
      '--filter',
      'until=168h',
      '--keep-storage',
      String(20 * 1024 ** 3),
      '--force'
    ]
  ])
  assert.ok(
    state.audits.find((item) => item.action === 'build-cache-retention.planned')
  )
  assert.ok(
    state.audits.find(
      (item) => item.action === 'build-cache-retention.removal-started'
    )
  )
  assert.equal(state.writes.at(-1).key, 'buildCacheRetentionLastRun')
  assert.doesNotMatch(state.logs.join('\n'), /reclaimed 74|freed 74/)
  await assert.rejects(
    fs.stat(path.join(root, 'db/image-operation-guard/cleanup')),
    { code: 'ENOENT' }
  )
})

for (const mode of ['preview', 'opt-out'])
  test(`cache ${mode} never invokes prune`, async (t) => {
    const { commands } = await fixture(
      t,
      mode === 'opt-out' ? { remove: false } : {}
    )
    assert.equal((await run({ preview: mode === 'preview' })).mode, 'dry-run')
    assert.deepEqual(await commands(), [])
  })

for (const active of ['initial-cache', 'fresh-cache', 'deployment'])
  test(`cache cleanup holds for ${active} activity`, async (t) => {
    const { state, commands } = await fixture(t)
    if (active === 'deployment') state.jobs = 1
    else state.inventories[active === 'initial-cache' ? 0 : 1].active = 1
    const result = await run()
    assert.equal(result.status, 'held')
    assert.deepEqual(result.holds, ['active-build-or-deployment'])
    assert.ok((await commands()).every((args) => args.includes('--help')))
  })

test('cache cleanup preserves a shared deployment guard and never starts Docker work', async (t) => {
  const { root, commands } = await fixture(t)
  const release = await guard.acquire(root)
  try {
    const result = await run()
    assert.equal(result.status, 'held')
    assert.deepEqual(result.holds, ['image-use-guard-present'])
    assert.deepEqual(await commands(), [])
  } finally {
    await release()
  }
})

test('unsupported bounded cache flags prevent mutation', async (t) => {
  const { mode, commands } = await fixture(t)
  await mode({ unsupported: true })
  assert.deepEqual((await run()).holds, ['bounded-cache-prune-unsupported'])
  assert.equal((await commands()).length, 1)
})

test('Docker builder aliasing modern Buildx retains seven days and20GiB using the equivalent reserved-space option', async (t) => {
  const { mode, commands } = await fixture(t)
  const help = await fs.readFile(
    path.resolve(
      __dirname,
      '../../../fixtures/docker-build-cache-help/buildx-0.38.1.txt'
    ),
    'utf8'
  )
  await mode({ help })
  const result = await run()
  assert.equal(result.status, 'complete')
  assert.equal(result.storageFlag, '--reserved-space')
  assert.deepEqual(await commands(), [
    ['builder', 'prune', '--help'],
    [
      'builder',
      'prune',
      '--all',
      '--filter',
      'until=168h',
      '--reserved-space',
      String(20 * 1024 ** 3),
      '--force'
    ]
  ])
})

test('an engine advertising only maximum-used/free-space controls cannot silently change retention policy', async (t) => {
  const { mode, commands } = await fixture(t)
  await mode({
    help: '  --all\n  --filter filter\n  --force\n  --max-used-space bytes\n  --min-free-space bytes\n'
  })
  assert.deepEqual((await run()).holds, ['bounded-cache-prune-unsupported'])
  assert.deepEqual(await commands(), [['builder', 'prune', '--help']])
})

test('failed audit prevents any cache mutation', async (t) => {
  const { commands, root } = await fixture(t)
  AuditLog.create = async () => {
    throw new Error('audit fixture unavailable')
  }
  await assert.rejects(run(), /audit fixture unavailable/)
  assert.deepEqual(await commands(), [])
  await assert.rejects(
    fs.stat(path.join(root, 'db/image-operation-guard/cleanup')),
    { code: 'ENOENT' }
  )
})

for (const failure of ['fail', 'timeout'])
  test(`cache ${failure} leaves an explicit conservative guard for unconfirmed completion`, async (t) => {
    const { mode, root, state } = await fixture(t, { maxRunMs: 1000 })
    await mode({ [failure]: true })
    await assert.rejects(run(), /completion is unconfirmed/)
    assert.ok(
      await fs.stat(path.join(root, 'db/image-operation-guard/cleanup'))
    )
    assert.equal(state.writes.at(-1).value.status, 'unconfirmed')
    assert.deepEqual((await run()).holds, ['image-cleanup-guard-present'])
  })

test('a confirmed cleanup with unavailable post-metrics claims no freed space and releases admission', async (t) => {
  const { state, root } = await fixture(t)
  state.disks[1] = null
  await assert.rejects(run(), /Build cache cleanup failed/)
  assert.equal(state.writes.at(-1).value.filesystemAvailableDeltaBytes, null)
  await assert.rejects(
    fs.stat(path.join(root, 'db/image-operation-guard/cleanup')),
    { code: 'ENOENT' }
  )
})

test('valid negative net filesystem change is preserved rather than reported as zero or reclaimed bytes', async (t) => {
  const { state } = await fixture(t)
  state.disks[1].availableBytes = 7000000000
  assert.equal((await run()).filesystemAvailableDeltaBytes, -1300000000)
})

test('cache inventory validates engine active counts and rejects incomplete or ambiguous JSON', () => {
  const row = {
    Type: 'Build Cache',
    TotalCount: '2731',
    Active: '0',
    Size: '113.4GB',
    Reclaimable: '21.29GB (18%)'
  }
  assert.equal(parse(JSON.stringify(row)).active, 0)
  for (const value of [
    { ...row, Active: 'unknown' },
    { ...row, Active: 3000 },
    { ...row, TotalCount: -1 },
    { ...row, Reclaimable: null }
  ])
    assert.throws(() => parse(JSON.stringify(value)), /incomplete/)
  assert.throws(
    () => parse(JSON.stringify(row) + '\n' + JSON.stringify(row)),
    /incomplete/
  )
  assert.throws(() => parse('not json'))
})

test('active updater admission holds cleanup without invoking any prune command', async (t) => {
  const { state, commands } = await fixture(t)
  state.update = { phase: 'pulling', maintenanceBusy: true }
  const result = await run()
  assert.equal(result.status, 'held')
  assert.deepEqual(result.holds, ['instance-update-active'])
  assert.deepEqual(await commands(), [])
})

test('updater admission is rechecked before mutation and unknown ownership fails closed', async (t) => {
  const { commands } = await fixture(t)
  let checks = 0
  sails.helpers.buildCacheRetention.getUpdateStatus = async () =>
    ++checks === 1
      ? { phase: 'idle' }
      : { phase: 'starting', maintenanceBusy: true }
  const result = await run()
  assert.equal(result.status, 'held')
  assert.deepEqual(result.holds, ['instance-update-active'])
  assert.deepEqual(await commands(), [['builder', 'prune', '--help']])
  sails.helpers.buildCacheRetention.getUpdateStatus = async () => {
    throw new Error('fixture ownership unavailable')
  }
  await assert.rejects(run(), /Build cache cleanup failed/)
  assert.deepEqual(await commands(), [['builder', 'prune', '--help']])
})

test('manual cleanup persists correlated real stages before mutation and measurement', async (t) => {
  const { state } = await fixture(t)
  const requestId = require('node:crypto').randomUUID()
  await run({ requestId })
  const snapshots = state.writes.map((v) => v.value)
  assert.ok(snapshots.every((v) => v.requestId === requestId))
  const phases = snapshots.map((v) => v.phase)
  assert.equal(phases[0], 'checking')
  assert.ok(phases.indexOf('pruning') > phases.indexOf('checking'))
  assert.ok(phases.indexOf('refreshing') > phases.indexOf('pruning'))
  assert.equal(phases.at(-1), 'complete')
  assert.equal(
    snapshots.find((v) => v.phase === 'pruning').filesystemAvailableDeltaBytes,
    null
  )
  assert.equal(
    snapshots.find((v) => v.phase === 'refreshing').dockerReportedReclaimed,
    '74.75GB'
  )
})
