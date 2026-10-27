const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const review =
  require('../../../../api/helpers/build-cache-retention/get-review').fn

test('read-only cleanup review detects maintenance ownership and interrupted updates without admitting a run', async (t) => {
  const oldSails = global.sails
  const oldJobs = global.DeploymentJob
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slipway-prune-review-'))
  let update = { phase: 'idle' }
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
    await fs.rm(root, { recursive: true, force: true })
  })
  assert.equal((await review()).available, true)
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
    held.holds.some((reason) => reason.includes('maintenance operation'))
  )
  assert.equal(
    await fs.readFile(path.join(directory, 'cleanup'), 'utf8'),
    'fixture retained guard'
  )
})
