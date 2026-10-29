const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const review =
  require('../../../../api/helpers/build-cache-retention/get-review').fn
const guard = require('../../../../api/lib/image-operation-guard')

test('read-only cleanup review detects maintenance ownership and interrupted updates without admitting a run', async (t) => {
  const oldSails = global.sails
  const oldJobs = global.DeploymentJob
  const inspect = guard.inspect
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slipway-prune-review-'))
  let update = { phase: 'idle' }
  let capabilities = { supported: true, storageFlag: '--reserved-space' }
  let deployments = 0
  global.sails = {
    config: { appPath: root },
    instanceQuest: {
      snapshot: async () => ({
        jobs: [{ name: 'retain-build-cache', manualAllowed: true }],
        runs: []
      })
    },
    helpers: {
      buildCacheRetention: {
        getUpdateStatus: async () => update,
        getCapabilities: async () => {
          if (capabilities instanceof Error) throw capabilities
          return capabilities
        },
        getPolicy: async () => ({
          remove: true,
          minimumUnusedHours: 168,
          keepStorageBytes: 20 * 1024 ** 3
        }),
        getInventory: async () => ({
          active: 0,
          entries: 4,
          size: '40GB',
          reclaimable: '20GB (50%)'
        })
      },
      lookout: {
        getDiskSpace: async () => ({ totalBytes: 1000, availableBytes: 500 })
      }
    }
  }
  global.DeploymentJob = { count: async () => deployments }
  t.after(async () => {
    global.sails = oldSails
    global.DeploymentJob = oldJobs
    guard.inspect = inspect
    await fs.rm(root, { recursive: true, force: true })
  })
  assert.equal((await review()).available, true)
  capabilities = { supported: false, storageFlag: null }
  const unsupported = await review()
  assert.equal(unsupported.available, false)
  assert.ok(
    unsupported.holds.some((value) =>
      value.includes('required bounded cache cleanup options')
    )
  )
  capabilities = new Error('fixture Docker unavailable')
  assert.ok(
    (await review()).holds.some((value) =>
      value.includes('capabilities could not be verified')
    )
  )
  capabilities = { supported: true, storageFlag: '--reserved-space' }
  await assert.rejects(fs.stat(path.join(root, 'db')), { code: 'ENOENT' })
  update = { phase: 'success', maintenanceBusy: true }
  assert.equal((await review()).available, false)
  update = { phase: 'interrupted' }
  assert.equal((await review()).available, false)
  update = { phase: 'idle' }
  deployments = 1
  assert.equal((await review()).available, false)
  deployments = 0
  const directory = path.join(root, 'db', 'image-operation-guard')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'cleanup'), 'fixture retained guard')
  const held = await review()
  assert.equal(held.available, false)
  assert.ok(
    held.holds.some((reason) => reason.includes('maintenance cleanup guard'))
  )
  assert.equal(
    await fs.readFile(path.join(directory, 'cleanup'), 'utf8'),
    'fixture retained guard'
  )
  guard.inspect = async () => ({ state: 'unverified', count: 6 })
  const unknown = await review()
  assert.equal(unknown.available, false)
  assert.ok(unknown.holds.some((reason) => reason.includes('host processes')))
  assert.equal(
    unknown.holds.some((reason) => reason.includes('operation holds')),
    false
  )
  guard.inspect = async () => ({ state: 'active', count: 1 })
  assert.ok(
    (await review()).holds.some((reason) => reason.includes('live process'))
  )
  guard.inspect = async () => ({ state: 'recoverable', count: 2 })
  sails.models = Object.fromEntries(
    [
      'deploymentjob',
      'deployment',
      'deploymentlease',
      'cleanupoperation',
      'setting'
    ].map((name) => [name, { count: async () => 0 }])
  )
  assert.equal((await review()).available, true)
  update = { phase: 'success', maintenanceBusy: true }
  assert.equal((await review()).available, false)
  update = { phase: 'idle' }
  sails.models.deploymentlease.count = async () => 1
  assert.equal((await review()).available, false)
  // Review never acquires, quarantines or removes the original fixture guard.
  assert.equal(
    await fs.readFile(path.join(directory, 'cleanup'), 'utf8'),
    'fixture retained guard'
  )
})
