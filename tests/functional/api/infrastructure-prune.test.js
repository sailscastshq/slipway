const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Infrastructure cache review and run require instance authority, CSRF and fixed registered inputs',
  { world: 'configured-slipway' },
  async ({ sails, request, world }) => {
    const original = {
      update: sails.helpers.buildCacheRetention.getUpdateStatus,
      quest: sails.instanceQuest,
      inventory: sails.helpers.buildCacheRetention.getInventory,
      disk: sails.helpers.lookout.getDiskSpace
    }
    let calls = 0
    let inventories = 0
    const runs = new Map()
    sails.helpers.buildCacheRetention.getInventory = async () => {
      inventories++
      return { entries: 20, active: 0, size: '40GB', reclaimable: '18GB (45%)' }
    }
    sails.helpers.lookout.getDiskSpace = async () => ({
      totalBytes: 300 * 1024 ** 3,
      availableBytes: 113 * 1024 ** 3
    })
    sails.helpers.buildCacheRetention.getUpdateStatus = async () => ({
      phase: 'idle'
    })
    sails.instanceQuest = {
      snapshot: async () => ({
        available: true,
        jobs: [{ name: 'retain-build-cache', manualAllowed: true }],
        runs: [...runs.values()]
      }),
      trigger: async (name, id, inputs) => {
        assert.equal(name, 'retain-build-cache')
        assert.deepEqual(inputs, {})
        const duplicate = runs.has(id)
        if (!duplicate) {
          calls++
          runs.set(id, {
            id,
            name,
            state: 'requested',
            startedAt: new Date().toISOString()
          })
        }
        return { run: runs.get(id), duplicate }
      }
    }
    try {
      assert.equal(
        (await request.get('/api/v1/bosun/disk-cleanup')).status,
        401
      )
      const browser = await withCsrfFromPage(request, '/lookout', 'genesisUser')
      const review = await browser.request.get('/api/v1/bosun/disk-cleanup')
      assert.equal(review.status, 200)
      assert.equal(review.data.cache.reclaimable, '18GB (45%)')
      assert.equal(review.data.policy.minimumUnusedHours, 168)
      assert.equal(calls, 0, 'review never triggers cleanup')
      const body = {
        name: 'retain-build-cache',
        requestId: randomUUID(),
        jobInputs: {}
      }
      assert.equal(
        (await request.as('genesisUser').post('/api/v1/bosun/quest/run', body))
          .status,
        403
      )
      assert.equal(calls, 0)
      assert.equal(
        (await browser.request.post('/api/v1/bosun/quest/run', body)).status,
        202
      )
      assert.equal(
        (await browser.request.post('/api/v1/bosun/quest/run', body)).status,
        200
      )
      assert.equal(calls, 1)
      const audit = await sails.models.auditlog.find({
        action: 'infrastructure.cache-prune.requested'
      })
      assert.equal(audit.length, 1)
      assert.equal(audit[0].user, world.current.users.genesisUser.id)
      assert.equal(audit[0].resourceId, body.requestId)
      await sails.models.user
        .updateOne({ id: world.current.users.genesisUser.id })
        .set({ isGenesisUser: false })
      const reads = inventories
      assert.equal(
        (await browser.request.get('/api/v1/bosun/disk-cleanup')).status,
        403
      )
      assert.equal(
        (await browser.request.post('/api/v1/bosun/quest/run', body)).status,
        403
      )
      assert.equal(inventories, reads)
      assert.equal(calls, 1)
    } finally {
      sails.helpers.buildCacheRetention.getUpdateStatus = original.update
      sails.instanceQuest = original.quest
      sails.helpers.buildCacheRetention.getInventory = original.inventory
      sails.helpers.lookout.getDiskSpace = original.disk
    }
  }
)

test(
  'Infrastructure cache review fails closed for disabled cleanup, incomplete inventory and active work',
  { world: 'configured-slipway' },
  async ({ sails, request, world }) => {
    const original = {
      update: sails.helpers.buildCacheRetention.getUpdateStatus,
      quest: sails.instanceQuest,
      policy: sails.config.buildCacheRetention,
      inventory: sails.helpers.buildCacheRetention.getInventory,
      disk: sails.helpers.lookout.getDiskSpace
    }
    sails.helpers.buildCacheRetention.getUpdateStatus = async () => ({
      phase: 'idle'
    })
    sails.instanceQuest = {
      snapshot: async () => ({
        jobs: [{ name: 'retain-build-cache', manualAllowed: false }],
        runs: []
      })
    }
    sails.config.buildCacheRetention = { remove: false }
    sails.helpers.buildCacheRetention.getInventory = async () => {
      throw new Error('fixture incomplete')
    }
    sails.helpers.lookout.getDiskSpace = async () => null
    try {
      const result = await request
        .as('genesisUser')
        .get('/api/v1/bosun/disk-cleanup')
      assert.equal(result.status, 200)
      assert.equal(result.data.available, false)
      assert.equal(result.data.cache, null)
      assert.equal(result.data.holds.length >= 4, true)
      sails.helpers.buildCacheRetention.getInventory = async () => ({
        active: 1,
        entries: 1,
        size: '1GB',
        reclaimable: '0B'
      })
      const active = await request
        .as('genesisUser')
        .get('/api/v1/bosun/disk-cleanup')
      assert.equal(active.data.available, false)
      assert.equal(
        active.data.holds.includes('A Docker build is using cache.'),
        true
      )
    } finally {
      sails.helpers.buildCacheRetention.getUpdateStatus = original.update
      sails.instanceQuest = original.quest
      sails.config.buildCacheRetention = original.policy
      sails.helpers.buildCacheRetention.getInventory = original.inventory
      sails.helpers.lookout.getDiskSpace = original.disk
    }
  }
)
