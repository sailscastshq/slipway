// Synthetic collector comparison: identical mocked model latency and no Docker/network.
// Also measures the real indexed idle-outbox query on local SQLite.
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { DatabaseSync } = require('node:sqlite')
const filename = path.resolve('api/hooks/lookout/index.js')
const oldSource = execFileSync(
  'git',
  [
    'show',
    '0fb573776551106a91a4d0f67f6a2be3712d5513:api/hooks/lookout/index.js'
  ],
  { encoding: 'utf8' }
)
const newSource = fs.readFileSync(filename, 'utf8')
async function measure(source, active = false) {
  const intervals = []
  const states = new Map()
  const count = {
    reads: 0,
    writes: 0,
    outboxReads: 0,
    outboxWrites: 0,
    idleQueries: 0
  }
  const samples = Array.from({ length: 50 }, (_, i) => ({
    containerName: 'slipway-fixture-' + i,
    environmentId: 1,
    stat: {
      cpuPercent: 1,
      memPercent: active ? 91 : 10,
      memUsage: 100,
      memLimit: 1000
    }
  }))
  for (const sample of samples)
    states.set(sample.containerName, {
      id: sample.containerName,
      lastSampleAt: Date.now(),
      memoryActive: active
    })
  let boot
  const sails = {
    config: {},
    log: { info() {}, warn() {}, verbose() {} },
    after: (event, callback) => {
      boot = callback()
    },
    helpers: {
      lookout: {
        ensureObservabilitySchema: async () => {},
        reconcileContainerStatuses: async () => [],
        collectContainerMetrics: async () => ({
          alertSamples: samples.map((sample) => ({
            ...sample,
            recordedAt: Date.now()
          }))
        }),
        queueResourceAlert: {
          with: async () => {
            count.outboxWrites++
          }
        },
        deliverResourceAlerts: async () => {
          count.idleQueries++
        }
      }
    }
  }
  const context = {
    module: { exports: {} },
    require: createRequire(filename),
    setInterval: (callback) => {
      intervals.push(callback)
      return intervals.length
    },
    clearInterval() {},
    ResourceAlertState: {
      findOne: async ({ containerName }) => {
        count.reads++
        return states.get(containerName)
      },
      updateOne: ({ id }) => ({
        set: async (value) => {
          count.writes++
          states.set(id, { ...states.get(id), ...value })
        }
      })
    },
    ResourceAlertDelivery: {
      find: () => ({
        limit: async () => {
          count.outboxReads++
          return [{ id: 1 }]
        }
      })
    }
  }
  vm.runInNewContext(source, context)
  await context.module.exports(sails).initialize()
  await boot
  while (count.writes < 50)
    await new Promise((resolve) => setImmediate(resolve))
  for (const key of Object.keys(count)) count[key] = 0
  const start = performance.now()
  for (let i = 0; i < 100; i++) await intervals[0]()
  return { durationMs: performance.now() - start, operations: count }
}
async function main() {
  const before = [],
    after = []
  let resultBefore, resultAfter
  for (let i = 0; i < 7; i++) {
    resultBefore = await measure(oldSource)
    resultAfter = await measure(newSource)
    before.push(resultBefore.durationMs)
    after.push(resultAfter.durationMs)
  }
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(
      'CREATE TABLE resource_alert_deliveries (id INTEGER PRIMARY KEY, status TEXT, next_attempt_at INTEGER, lease_until INTEGER); CREATE INDEX resource_alert_deliveries_due ON resource_alert_deliveries(status,next_attempt_at,lease_until)'
    )
    const query = db.prepare(
      "SELECT id FROM resource_alert_deliveries WHERE status='pending' AND next_attempt_at<=? AND lease_until<=? LIMIT 5"
    )
    const start = performance.now()
    for (let i = 0; i < 10000; i++) query.all(Date.now(), Date.now())
    const idleQueryMeanMicroseconds =
      ((performance.now() - start) * 1000) / 10000
    const median = (values) => [...values].sort((a, b) => a - b)[3]
    console.log(
      JSON.stringify(
        {
          methodology:
            '7 paired in-memory runs; each 100 collector cycles with 50 healthy containers. Model operations mocked equally; excludes Docker, mail and production latency.',
          beforeMedianMs: median(before),
          afterMedianMs: median(after),
          beforeOperations: resultBefore.operations,
          afterOperations: resultAfter.operations,
          activeIncidents: {
            before: await measure(oldSource, true),
            after: await measure(newSource, true)
          },
          idleOutboxQuery: {
            methodology:
              '10000 indexed queries on empty local SQLite; one query each 30-second delivery tick',
            meanMicroseconds: idleQueryMeanMicroseconds
          }
        },
        null,
        2
      )
    )
  } finally {
    db.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
