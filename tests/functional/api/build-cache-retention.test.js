const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('sounding')

test(
  'registered build-cache helpers persist a safe preview with fixture inventory',
  { world: 'configured-slipway' },
  async ({ sails }) => {
    const original = {
      appPath: sails.config.appPath,
      policy: sails.config.buildCacheRetention,
      inventory: sails.helpers.buildCacheRetention.getInventory,
      disk: sails.helpers.lookout.getDiskSpace
    }
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'slipway-cache-preview-')
    )
    try {
      assert.equal(
        typeof sails.helpers.buildCacheRetention.getInventory.with,
        'function'
      )
      sails.config.appPath = root
      sails.config.buildCacheRetention = { remove: true }
      sails.helpers.buildCacheRetention.getInventory = async () => ({
        entries: 4,
        active: 0,
        size: '2GB',
        reclaimable: '1GB (50%)'
      })
      sails.helpers.lookout.getDiskSpace = async () => ({
        totalBytes: 1000000,
        availableBytes: 500000
      })
      const result = await sails.helpers.buildCacheRetention.run.with({
        preview: true
      })
      assert.equal(result.status, 'dry-run')
      assert.equal(result.mode, 'dry-run')
      assert.equal(result.cacheBefore.entries, 4)
      assert.equal(result.cacheAfter, null)
      assert.equal(result.filesystemAvailableDeltaBytes, null)
      assert.equal(result.dockerReportedReclaimed, null)
      assert.equal(
        await sails.models.auditlog.count({
          action: 'build-cache-retention.finished'
        }),
        1
      )
      assert.deepEqual(
        await fs.readdir(path.join(root, 'db/image-operation-guard')),
        []
      )
    } finally {
      sails.config.appPath = original.appPath
      sails.config.buildCacheRetention = original.policy
      sails.helpers.buildCacheRetention.getInventory = original.inventory
      sails.helpers.lookout.getDiskSpace = original.disk
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
