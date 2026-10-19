const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const getPolicy = require('../../../../api/helpers/image-retention/get-policy')
const getPlan = require('../../../../api/helpers/image-retention/get-plan')
const run = require('../../../../api/helpers/image-retention/run')
const removeImage = require('../../../../api/helpers/image-retention/remove-image')
const job = require('../../../../scripts/retain-deployment-images')
const DAY = 86400000
const NOW = Date.UTC(2026, 9, 16)
const id = (n) => `sha256:${n.toString(16).padStart(64, '0')}`
const tag = (n) => `slipway/demo-production-web:${n}`

async function fixture(t, config = {}) {
  const keys = [
    'sails',
    'Setting',
    'Deployment',
    'App',
    'DeploymentJob',
    'Service',
    'CleanupOperation',
    'AuditLog'
  ]
  const original = Object.fromEntries(keys.map((key) => [key, global[key]]))
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-image-retention-')
  )
  await fs.mkdir(path.join(root, 'db'))
  t.after(async () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete global[key]
      else global[key] = value
    }
    await fs.rm(root, { recursive: true, force: true })
  })
  const state = {
    recovery: [],
    deployments: [],
    apps: [],
    jobs: [],
    services: [],
    cleanups: [],
    audits: [],
    writes: [],
    removed: [],
    images: [],
    containers: [],
    logs: []
  }
  for (const [name, key] of [
    ['Setting', 'recovery'],
    ['Deployment', 'deployments'],
    ['App', 'apps'],
    ['DeploymentJob', 'jobs'],
    ['Service', 'services'],
    ['CleanupOperation', 'cleanups']
  ]) {
    global[name] = {
      find: () => ({
        select: () => ({ limit: async (limit) => state[key].slice(0, limit) })
      })
    }
  }
  global.AuditLog = {
    create: async (value) => state.audits.push(structuredClone(value))
  }
  global.sails = {
    config: { appPath: root, imageRetention: config },
    log: { info: (line) => state.logs.push(line), error() {} },
    helpers: {
      setting: {
        set: async (key, value) =>
          state.writes.push({ key, value: JSON.parse(value) })
      },
      imageRetention: {
        getPolicy: () => getPolicy.fn(),
        run: { with: (input) => run.fn(input) },
        getInventory: {
          with: async () => ({
            images: structuredClone(state.images),
            containers: structuredClone(state.containers)
          })
        },
        getPlan: { with: (input) => getPlan.fn(input) },
        removeImage: {
          with: async ({ imageId, tags = [] }) => {
            state.removed.push(imageId)
            state.images = state.images.filter((image) => image.id !== imageId)
            return { removed: true, untagged: tags }
          }
        }
      }
    }
  }
  function deployment(n, overrides = {}) {
    state.deployments.push({
      id: n,
      app: 1,
      environment: 1,
      status: 'stopped',
      imageName: tag(n),
      imageId: null,
      createdAt: NOW - (100 - n) * DAY,
      ...overrides
    })
    state.images.push({
      id: id(n),
      created: new Date(NOW - 100 * DAY).toISOString(),
      size: 1000,
      tags: [tag(n)],
      digests: []
    })
    return state.images.at(-1)
  }
  const policy = await getPolicy.fn()
  const plan = () =>
    getPlan.fn({
      inventory: { images: state.images, containers: state.containers },
      policy,
      now: NOW
    })
  return { state, policy, plan, deployment, root }
}

test('explicit removal keeps a bounded daily backlog, 14 days and three successful images', async (t) => {
  const { policy } = await fixture(t)
  assert.equal(policy.remove, true)
  assert.equal(policy.minimumAgeDays, 14)
  assert.equal(policy.keepSuccessful, 3)
  assert.equal(policy.maxRemovals, 100)
  assert.equal(job.quest.interval, '24 hours')
  assert.equal(job.quest.withoutOverlapping, true)
  sails.config.imageRetention.minimumAgeDays = 7
  await assert.rejects(getPolicy.fn(), /Invalid image retention limit/)
  sails.config.imageRetention = { remove: 'true' }
  assert.equal((await getPolicy.fn()).remove, false)
})

test('old active and stopped-container images stay; latest three successful images stay', async (t) => {
  const { state, deployment, plan } = await fixture(t)
  for (let n = 1; n <= 6; n++) deployment(n)
  state.containers.push({ id: 'stopped-container', imageId: id(1) })
  state.deployments.find((d) => d.id === 2).status = 'building'
  state.apps.push({ id: 1, currentDeployment: 3, imageName: tag(3) })
  const result = await plan()
  assert.equal(result.status, 'planned')
  assert.deepEqual(result.candidates, [])
  assert.deepEqual(result.protected.find((x) => x.id === id(1)).reasons, [
    'container'
  ])
  assert.ok(
    result.protected
      .find((x) => x.id === id(2))
      .reasons.includes('active-deployment')
  )
  assert.ok(
    result.protected
      .find((x) => x.id === id(3))
      .reasons.includes('current-release')
  )
})

test('rollback job, pin and service recovery protect images beyond the retention window', async (t) => {
  const { state, deployment, plan, policy } = await fixture(t)
  for (let n = 1; n <= 8; n++) deployment(n)
  state.jobs.push({
    id: 10,
    stage: 'queued',
    deployment: 8,
    targetDeploymentId: 1,
    imageName: tag(1)
  })
  policy.pinnedImages = [id(2)]
  state.services.push({
    id: 2,
    status: 'running',
    imageReference: id(8),
    imageMetadata: { previous: { imageReference: id(3) } }
  })
  const result = await plan()
  assert.deepEqual(
    result.candidates.map((x) => x.id),
    [id(4), id(5)]
  )
  for (const n of [1, 2, 3, 6, 7, 8])
    assert.ok(result.protected.some((x) => x.id === id(n)))
})

test('groups rollbacks by app and environment, keeps distinct images, and breaks ties by deployment ID', async (t) => {
  const { state, deployment, plan } = await fixture(t)
  for (let n = 1; n <= 5; n++) deployment(n, { createdAt: NOW - 100 * DAY })
  state.deployments.push({ ...state.deployments.at(-1), id: 6 }) // same image: does not consume another retained slot
  deployment(7, { app: 2 })
  deployment(8, { environment: 2 })
  assert.deepEqual(
    (await plan()).candidates.map((x) => x.id),
    [id(1), id(2)]
  )
})

test('14-day boundary, unknown aliases, untagged images, control-plane releases and Coolify stay', async (t) => {
  const { state, deployment, plan } = await fixture(t)
  for (let n = 1; n <= 8; n++) deployment(n)
  state.images[0].created = new Date(NOW - 14 * DAY).toISOString()
  state.images[1].tags.push('other/unknown:latest')
  state.images[2].tags = []
  state.images[3].tags = ['ghcr.io/sailscastshq/slipway:0.0.99']
  state.images[4].tags = ['ghcr.io/coollabsio/coolify:old']
  assert.deepEqual((await plan()).candidates, [])
})

test('an unresolved pin or recovery reference holds the entire run instead of guessing identity', async (t) => {
  const { state, deployment, plan, policy } = await fixture(t)
  for (let n = 1; n <= 5; n++) deployment(n)
  policy.pinnedImages = ['slipway/missing:1']
  assert.equal((await plan()).status, 'held')
  assert.deepEqual((await plan()).candidates, [])
  policy.pinnedImages = []
  state.services.push({
    id: 1,
    imageReference: id(5),
    customRecovery: { previous: { imageReference: id(999) } }
  })
  assert.equal((await plan()).status, 'held')
})

test('incomplete bounded records, missing job targets and retained resource snapshots fail closed', async (t) => {
  const { state, deployment, plan, policy } = await fixture(t)
  for (let n = 1; n <= 5; n++) deployment(n)
  policy.maxRecords = 3
  await assert.rejects(plan(), /reference inventory exceeds/)
  policy.maxRecords = 20
  state.jobs.push({ id: 1, stage: 'queued', deployment: 999 })
  assert.equal((await plan()).status, 'held')
  state.jobs = []
  state.cleanups.push({
    id: 1,
    snapshot: { artifacts: { imageNames: [tag(1)] } }
  })
  assert.deepEqual(
    (await plan()).candidates.map((x) => x.id),
    [id(2)]
  )
})

test('explicitly enabled daily cleanup removes only eligible images and returns a compact plain summary', async (t) => {
  const { state, deployment } = await fixture(t)
  for (let n = 1; n <= 5; n++) deployment(n)
  const result = await job.fn()
  assert.equal(result.status, 'complete')
  assert.equal(result.mode, 'remove')
  assert.equal(result.candidates, 2)
  assert.equal(result.removed, 2)
  assert.equal(result.errors, 0)
  assert.deepEqual(state.removed, [id(1), id(2)])
  assert.ok(
    state.audits.some((x) => x.action === 'image-retention.image-removed')
  )
  assert.ok(state.writes.every((x) => x.key === 'imageRetentionLastRun'))
  assert.ok(JSON.stringify(result).length < 500)
  assert.equal(state.logs.length, 1)
  assert.match(
    state.logs[0],
    /Clean up deployment images: complete .*removed 2, skipped 0, errors 0/
  )
  assert.doesNotMatch(state.logs[0], /\u001b|sha256:|reclaimed/)
})

test('explicit per-run preview and server opt-out never invoke removal', async (t) => {
  const { state, deployment } = await fixture(t)
  for (let n = 1; n <= 5; n++) deployment(n)
  assert.equal((await job.fn({ preview: true })).mode, 'dry-run')
  sails.config.imageRetention.remove = false
  assert.equal((await job.fn()).mode, 'dry-run')
  assert.deepEqual(state.removed, [])
  assert.ok(
    !state.audits.some((x) => x.action === 'image-retention.removal-started')
  )
})

test('default backlog sweep removes at most 100 and reports deferred images for the next run', async (t) => {
  const { state, deployment } = await fixture(t)
  for (let n = 1; n <= 108; n++) deployment(n)
  const first = await job.fn()
  assert.equal(first.removed, 100)
  assert.equal(first.deferred, 5)
  assert.equal(first.skipped, 5)
  const next = await job.fn()
  assert.equal(next.removed, 5)
  assert.equal(next.deferred, 0)
  assert.equal(state.removed.length, 105)
})

test('startup config enables removal by default and preserves explicit opt-out', async () => {
  const vm = require('node:vm')
  const source = await fs.readFile(
    require.resolve('../../../../config/image-retention'),
    'utf8'
  )
  for (const [value, expected] of [
    [undefined, true],
    ['true', true],
    ['false', false],
    ['invalid', false]
  ]) {
    const context = {
      module: { exports: {} },
      process: {
        env:
          value === undefined ? {} : { SLIPWAY_IMAGE_RETENTION_REMOVE: value }
      }
    }
    vm.runInNewContext(source, context)
    const policy = context.module.exports.imageRetention
    assert.equal(policy.remove, expected)
    assert.equal(policy.minimumAgeDays, 14)
    assert.equal(policy.keepSuccessful, 3)
    assert.equal(policy.maxRemovals, 100)
  }
})

test('single-flight lock excludes a simultaneous worker and is released after completion', async (t) => {
  const { state, deployment, root } = await fixture(t, { remove: false })
  for (let n = 1; n <= 5; n++) deployment(n)
  let release, entered
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const inventory = sails.helpers.imageRetention.getInventory.with
  sails.helpers.imageRetention.getInventory.with = async (input) => {
    entered()
    await gate
    return inventory(input)
  }
  const first = run.fn()
  await started
  const busy = await run.fn()
  assert.equal(busy.status, 'busy')
  assert.equal(busy.summary.mode, 'dry-run')
  assert.deepEqual(busy.summary.holds, ['image-retention-lock-present'])
  release()
  assert.equal((await first).status, 'dry-run')
  await assert.rejects(fs.stat(path.join(root, 'db', 'image-retention.lock')), {
    code: 'ENOENT'
  })
  assert.deepEqual(state.removed, [])
})

test('removal rechecks fresh references, skips a new pin and honors its batch bound', async (t) => {
  const { state, deployment } = await fixture(t, {
    remove: true,
    maxRemovals: 1
  })
  for (let n = 1; n <= 6; n++) deployment(n)
  const inventory = sails.helpers.imageRetention.getInventory.with
  let calls = 0
  sails.helpers.imageRetention.getInventory.with = async (input) => {
    if (++calls === 2)
      state.containers.push({ id: 'new-container', imageId: id(1) })
    return inventory(input)
  }
  const first = await run.fn()
  assert.equal(first.status, 'complete')
  assert.deepEqual(state.removed, [id(2)])
  assert.equal(first.skipped[0].reason, 'protection-or-inventory-changed')
  assert.equal(calls, 3)
  state.containers = []
  const second = await run.fn()
  assert.deepEqual(second.removed, [id(1)])
  assert.ok(
    state.audits.some((x) => x.action === 'image-retention.image-removed')
  )
})

test('audit/inventory failures prevent removal and release the lock; removal helper also enforces opt-out', async (t) => {
  const { state, deployment, root } = await fixture(t, { remove: true })
  for (let n = 1; n <= 5; n++) deployment(n)
  AuditLog.create = async () => {
    throw new Error('audit unavailable')
  }
  await assert.rejects(run.fn(), /audit unavailable/)
  assert.deepEqual(state.removed, [])
  await assert.rejects(fs.stat(path.join(root, 'db', 'image-retention.lock')), {
    code: 'ENOENT'
  })
  sails.config.imageRetention.remove = false
  await assert.rejects(removeImage.fn({ imageId: id(1) }), /disabled/)
  sails.config.imageRetention.remove = true
  await assert.rejects(
    removeImage.fn({ imageId: 'short-id' }),
    /complete immutable/
  )
})

test('cleanup is held while a deployment or rollback holds shared image admission', async (t) => {
  const { state, root } = await fixture(t, { remove: true })
  const release =
    await require('../../../../api/lib/image-operation-guard').acquire(root)
  try {
    const result = await run.fn()
    assert.equal(result.status, 'held')
    assert.deepEqual(state.removed, [])
    assert.deepEqual(result.holds, ['image-use-guard-present'])
    assert.equal(result.summary.mode, 'remove')
    assert.deepEqual(result.summary.holds, ['image-use-guard-present'])
    assert.match(state.logs.at(-1), /Hold: image-use-guard-present/)
    const {
      safeResult
    } = require('../../../../packages/hook/lib/quest-runtime')
    const redactor = {
      available: true,
      text: (value) => value,
      value: (value) => value
    }
    assert.equal(
      safeResult(
        { status: 'available', value: result.summary },
        redactor,
        16384
      ).status,
      'available'
    )
  } finally {
    await release()
  }
})

test('a failed removal records each candidate as removed, failed or skipped', async (t) => {
  const { state, deployment } = await fixture(t, { remove: true })
  for (let n = 1; n <= 7; n++) deployment(n)
  const remove = sails.helpers.imageRetention.removeImage.with
  let attempts = 0
  sails.helpers.imageRetention.removeImage.with = async (input) => {
    if (++attempts === 2) throw new Error('fixture Docker removal failed')
    return remove(input)
  }
  await assert.rejects(run.fn(), /fixture Docker removal failed/)
  const outcome = state.writes.at(-1).value
  assert.deepEqual(outcome.removed, [id(1)])
  assert.deepEqual(
    outcome.failed.map((item) => item.id),
    [id(2)]
  )
  assert.deepEqual(
    outcome.skipped.map((item) => item.id),
    [id(3), id(4)]
  )
  assert.equal(outcome.status, 'failed')
})

test('multi-tag deferral performs no removal and later independent candidates still proceed', async (t) => {
  const { state, deployment } = await fixture(t, { maxRemovals: 2 })
  for (let n = 1; n <= 7; n++) deployment(n)
  state.images[0].tags.push(tag(2))
  state.images = state.images.filter((image) => image.id !== id(2))
  const original = sails.helpers.imageRetention.removeImage.with
  sails.helpers.imageRetention.removeImage.with = async (input) =>
    input.tags.length > 1 ? removeImage.fn(input) : original(input)
  const result = await run.fn()
  assert.deepEqual(state.removed, [id(3), id(4)])
  assert.deepEqual(result.removed, [id(3), id(4)])
  assert.equal(result.status, 'complete')
  assert.equal(result.summary.errors, 0)
  assert.equal(result.summary.deferred, 1)
  assert.equal(result.skipped[0].reason, 'multiple-image-tags')
  assert.deepEqual(state.images.find((image) => image.id === id(1)).tags, [
    tag(1),
    tag(2)
  ])
})

test('expected Docker conflicts defer one image and continue independent candidates up to confirmed-removal bound', async (t) => {
  const { state, deployment } = await fixture(t, { maxRemovals: 2 })
  for (let n = 1; n <= 7; n++) deployment(n)
  const original = sails.helpers.imageRetention.removeImage.with
  sails.helpers.imageRetention.removeImage.with = async (input) =>
    input.imageId === id(1)
      ? {
          removed: false,
          reason: 'docker-conflict',
          deferred: true,
          untagged: []
        }
      : original(input)
  const result = await run.fn()
  assert.deepEqual(result.removed, [id(2), id(3)])
  assert.equal(result.status, 'complete')
  assert.equal(result.summary.errors, 0)
  assert.equal(result.summary.deferred, 2)
  assert.equal(
    result.skipped.find((item) => item.id === id(1)).reason,
    'docker-conflict'
  )
  assert.equal(
    result.skipped.find((item) => item.id === id(4)).reason,
    'batch-limit'
  )
})

test('all eligible shared tags are candidates, but any protected, unknown or digest alias protects the whole ID', async (t) => {
  const { state, deployment, plan, policy } = await fixture(t)
  for (let n = 1; n <= 6; n++) deployment(n)
  state.images[0].tags.push(tag(2))
  state.images = state.images.filter((item) => item.id !== id(2))
  assert.ok((await plan()).candidates.some((item) => item.id === id(1)))
  policy.pinnedImages = [tag(2)]
  assert.ok(!(await plan()).candidates.some((item) => item.id === id(1)))
  policy.pinnedImages = []
  state.images[0].tags.push('unrelated/keep:latest')
  assert.ok(!(await plan()).candidates.some((item) => item.id === id(1)))
  state.images[0].tags.pop()
  state.images[0].digests.push('unrelated/keep@' + id(1))
  assert.ok(
    (await plan()).protected
      .find((item) => item.id === id(1))
      .reasons.includes('digest-reference')
  )
})

test('explicit previous recovery image survives beyond recent-success floor and recovery holds stop cleanup', async (t) => {
  const { state, deployment, plan } = await fixture(t)
  const recovery = require('../../../../api/lib/deployment-recovery')
  for (let n = 1; n <= 8; n++) deployment(n)
  state.apps.push({
    id: 1,
    environment: 1,
    currentDeployment: 8,
    imageId: id(8),
    imageName: tag(8)
  })
  state.recovery.push({
    key: recovery.key(1),
    value: JSON.stringify({
      version: 1,
      appId: '1',
      environmentId: '1',
      rejectedImages: [],
      current: {
        deploymentId: '8',
        imageId: id(8),
        promotedAt: 800,
        compatibility: 'schema-1'
      },
      previous: {
        deploymentId: '1',
        imageId: id(1),
        promotedAt: 100,
        compatibility: 'schema-1'
      }
    })
  })
  let result = await plan()
  assert.ok(
    result.protected
      .find((item) => item.id === id(1))
      .reasons.includes('recovery-previous')
  )
  assert.ok(!result.candidates.some((item) => item.id === id(1)))
  state.recovery.push({ key: recovery.HOLD_PREFIX + '1', value: '{}' })
  result = await plan()
  assert.equal(result.status, 'held')
  assert.deepEqual(result.candidates, [])
})

test('unexplained orphan recovery metadata still holds all image retention', async (t) => {
  const { state, deployment, plan } = await fixture(t)
  for (let n = 1; n <= 5; n++) deployment(n, { status: 'failed' })
  assert.equal((await plan()).candidates.length, 5)
  state.recovery.push({
    key: 'deploymentRecovery:v1:999',
    value: JSON.stringify({
      version: 1,
      appId: '999',
      environmentId: '999',
      current: {
        deploymentId: '999',
        imageId: id(1),
        promotedAt: NOW,
        compatibility: null
      },
      previous: null,
      rejectedImages: []
    })
  })
  const result = await plan()
  assert.equal(result.status, 'held')
  assert.deepEqual(result.candidates, [])
  assert.ok(
    result.holds.includes(
      'Recovery metadata does not match the app traffic owner'
    )
  )
})

for (const [marker, reason] of [
  ['cleanup', 'image-cleanup-guard-present'],
  ['admission', 'image-admission-guard-busy']
]) {
  test(`cleanup exposes ${reason} without removing its marker`, async (t) => {
    const { root, state } = await fixture(t)
    const directory = path.join(root, 'db', 'image-operation-guard')
    await fs.mkdir(directory, { recursive: true })
    const markerPath = path.join(directory, marker)
    if (marker === 'admission') await fs.mkdir(markerPath)
    else
      await fs.writeFile(
        markerPath,
        JSON.stringify({ pid: 999999, startedAt: 1 })
      )
    const result = await run.fn()
    assert.equal(result.status, 'held')
    assert.equal(result.summary.mode, 'remove')
    assert.deepEqual(result.summary.holds, [reason])
    assert.deepEqual(state.removed, [])
    assert.ok(await fs.stat(markerPath))
    assert.doesNotMatch(state.logs.at(-1), /undefined|stale|expired/)
  })
}

test('inventory holds remain explicit in bounded redacted job summaries', async (t) => {
  const { state, policy } = await fixture(t)
  policy.pinnedImages = ['missing']
  sails.config.imageRetention.pinnedImages = ['missing']
  sails.hooks = {
    secrets: { text: (value) => value.replaceAll('missing', '<redacted>') }
  }
  const result = await job.fn()
  assert.equal(result.status, 'held')
  assert.equal(result.mode, 'remove')
  assert.match(result.holds[0], /Unresolved pin reference: <redacted>/)
  assert.deepEqual(state.removed, [])
  assert.doesNotMatch(state.logs.at(-1), /missing/)
})
