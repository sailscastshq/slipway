const { test } = require('sounding')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
async function hookFixture(
  sails,
  { state, deliveries = [], stat, delivery = async () => {} }
) {
  const filename = path.resolve('api/hooks/lookout/index.js')
  const intervals = []
  const calls = { writes: 0, queued: [], metrics: 0 }
  let boot
  const fake = {
    config: { custom: { baseUrl: 'https://fixture.invalid' } },
    log: { info() {}, warn() {}, verbose() {} },
    after: (event, callback) => {
      boot = callback()
    },
    helpers: {
      lookout: {
        ensureObservabilitySchema: async () => {},
        reconcileContainerStatuses: async () => [],
        collectContainerMetrics: async () => {
          calls.metrics++
          return {
            alertSamples: [
              {
                stat,
                containerName: 'slipway-fixture',
                environmentId: 1,
                recordedAt: 100000
              }
            ]
          }
        },
        deliverResourceAlerts: delivery,
        queueResourceAlert: {
          with: async (value) => {
            calls.queued.push(value)
            deliveries.push({ id: calls.queued.length })
          }
        }
      }
    }
  }
  const context = {
    module: { exports: {} },
    require: require('node:module').createRequire(filename),
    setInterval: (callback) => {
      intervals.push(callback)
      return intervals.length
    },
    clearInterval() {},
    ResourceAlertState: {
      findOne: async () => state,
      updateOne: () => ({
        set: async (value) => {
          calls.writes++
          Object.assign(state, value)
        }
      })
    },
    ResourceAlertDelivery: {
      find: () => ({ limit: async () => deliveries.slice(0, 1) })
    },
    Environment: {
      findOne: () => ({
        populate: async () => ({
          slug: 'production',
          project: { slug: 'fixture' }
        })
      })
    }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context)
  const hook = context.module.exports(fake)
  await hook.initialize()
  await boot
  while (!calls.writes) await new Promise((resolve) => setImmediate(resolve))
  return { calls, intervals, hook, state }
}
test('upgraded active incidents enqueue once from fresh high data with a container-specific link', async ({
  sails
}) => {
  const state = { id: 1, memoryActive: true, lastSampleAt: 70000 }
  const f = await hookFixture(sails, {
    state,
    stat: { cpuPercent: 0.01, memPercent: 90.6, memUsage: 464, memLimit: 512 }
  })
  assert.equal(f.calls.queued.length, 1)
  const queued = f.calls.queued[0]
  assert.equal(queued.previousSampleAt, 70000)
  assert.equal(queued.payload.observedAt, 100000)
  assert.ok(queued.payload.lookoutUrl.endsWith('?container=slipway-fixture'))
  await f.intervals[0]()
  assert.equal(f.calls.queued.length, 1)
  f.hook.teardown(() => {})
})
test('blocked notification delivery never blocks the independent metrics collector', async ({
  sails
}) => {
  const f = await hookFixture(sails, {
    state: { id: 1, lastSampleAt: 70000 },
    stat: { cpuPercent: 1, memPercent: 10 },
    delivery: () => new Promise(() => {})
  })
  await f.intervals[0]()
  assert.equal(f.calls.metrics, 2)
  assert.equal(f.calls.writes, 2)
  f.hook.teardown(() => {})
})
