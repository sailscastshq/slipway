const { test } = require('sounding')

test('empty Docker stats still record a successful collector run', async ({
  sails,
  expect
}) => {
  await resetObservabilityHealth(sails)
  const original = sails.helpers.docker.getContainerStats
  replace(sails.helpers.docker, 'getContainerStats', async () => [])

  try {
    const result = await sails.helpers.lookout.collectContainerMetrics()
    const health = await sails.helpers.lookout.getObservabilityHealth()

    expect(result.details).toEqual({
      dockerRows: 0,
      managedRows: 0,
      recordedRows: 0
    })
    expect(health.collector.status).toBe('healthy')
    expect(health.collector.rowCount).toBe(0)
  } finally {
    sails.helpers.docker.getContainerStats = original
  }
})

test('Docker errors are reported without becoming retention failures', async ({
  sails,
  expect
}) => {
  await resetObservabilityHealth(sails)
  const originalStats = sails.helpers.docker.getContainerStats
  const originalDisk = sails.helpers.lookout.getDiskSpace
  replace(sails.helpers.docker, 'getContainerStats', async () => {
    throw new Error('Docker socket unavailable')
  })
  replace(sails.helpers.lookout, 'getDiskSpace', async () => null)

  try {
    let collectionError
    try {
      await sails.helpers.lookout.collectContainerMetrics()
    } catch (error) {
      collectionError = error
    }

    const maintenance =
      await sails.helpers.lookout.runObservabilityMaintenance()
    const health = await sails.helpers.lookout.getObservabilityHealth()

    expect(collectionError.message).toBe('Docker socket unavailable')
    expect(maintenance.disk.available).toBe(false)
    expect(health.collector.status).toBe('failed')
    expect(health.collector.lastError).toBe('Docker socket unavailable')
    expect(health.retention.status).toBe('healthy')
  } finally {
    sails.helpers.docker.getContainerStats = originalStats
    sails.helpers.lookout.getDiskSpace = originalDisk
  }
})

test('retention respects exact cutoffs and drains large tables in batches', async ({
  sails,
  expect
}) => {
  await clearTelemetry(sails)
  const now = Date.now()
  const containerCutoff = now - 24 * 60 * 60 * 1000
  const telemetryCutoff = now - 7 * 24 * 60 * 60 * 1000
  const environmentId = 1
  const expiredMetrics = Array.from({ length: 205 }, (_, index) =>
    containerMetric({
      environmentId,
      recordedAt: containerCutoff - 1000 - index
    })
  )

  for (let index = 0; index < expiredMetrics.length; index += 50) {
    await sails.models.containermetric.createEach(
      expiredMetrics.slice(index, index + 50)
    )
  }
  await sails.models.containermetric.createEach([
    containerMetric({ environmentId, recordedAt: containerCutoff }),
    containerMetric({ environmentId, recordedAt: containerCutoff + 1 })
  ])
  await sails.models.telemetryspan.createEach([
    span({ environmentId, startedAt: telemetryCutoff - 1 }),
    span({ environmentId, startedAt: telemetryCutoff })
  ])
  await sails.models.telemetryexception.createEach([
    exception({ environmentId, occurredAt: telemetryCutoff - 1 }),
    exception({ environmentId, occurredAt: telemetryCutoff })
  ])
  await sails.models.telemetrymetric.createEach([
    metric({ environmentId, recordedAt: telemetryCutoff - 1 }),
    metric({ environmentId, recordedAt: telemetryCutoff })
  ])
  await sails.models.telemetryconnection.create({
    app: 'retention-test-app',
    environment: String(environmentId),
    deployment: '42',
    hookVersion: '0.0.9',
    protocolVersion: 1,
    startedAt: telemetryCutoff - 1,
    lastSeenAt: telemetryCutoff - 1
  })

  const first = await sails.helpers.lookout.pruneObservability.with({
    now,
    containerRetentionMs: 24 * 60 * 60 * 1000,
    telemetryRetentionMs: 7 * 24 * 60 * 60 * 1000,
    batchSize: 50,
    maxBatches: 3
  })

  expect(first.tables.containerMetrics.deletedRows).toBe(150)
  expect(first.tables.containerMetrics.backlogRows).toBe(55)
  expect(first.hasBacklog).toBe(true)
  expect(first.retentionLagMs > 0).toBe(true)

  const second = await sails.helpers.lookout.pruneObservability.with({
    now,
    containerRetentionMs: 24 * 60 * 60 * 1000,
    telemetryRetentionMs: 7 * 24 * 60 * 60 * 1000,
    batchSize: 50,
    maxBatches: 3
  })

  expect(second.tables.containerMetrics.deletedRows).toBe(55)
  expect(second.hasBacklog).toBe(false)
  expect(await sails.models.containermetric.count()).toBe(2)
  expect(await sails.models.telemetryspan.count()).toBe(1)
  expect(await sails.models.telemetryexception.count()).toBe(1)
  expect(await sails.models.telemetrymetric.count()).toBe(1)
  expect(await sails.models.telemetryconnection.count()).toBe(1)
})

test('preparing observability storage leaves legacy metrics out of web startup', async ({
  sails,
  expect
}) => {
  await sails.models.containermetric.destroy({})
  const source = sails.getDatastore()

  await source.sendNativeQuery('DROP TABLE IF EXISTS container_metrics')
  await source.sendNativeQuery(`
    CREATE TABLE container_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      container_name TEXT,
      container_type TEXT,
      cpu_percent INTEGER,
      memory_usage INTEGER,
      memory_limit INTEGER,
      memory_percent INTEGER,
      net_io TEXT,
      block_io TEXT,
      pids INTEGER,
      recorded_at INTEGER,
      environment INTEGER,
      app INTEGER,
      service INTEGER
    )
  `)
  await source.sendNativeQuery(
    `INSERT INTO container_metrics (
      created_at, updated_at, container_name, container_type, cpu_percent,
      memory_usage, memory_limit, memory_percent, pids, recorded_at,
      environment
    ) VALUES
      (1, 1, 'slipway-one', 'app', 1, 10, 100, 10, 1, 1000, 1),
      (2, 2, 'slipway-two', 'service', 2, 20, 100, 20, 2, 2000, 1),
      (3, 3, 'slipway-three', 'app', 3, 30, 100, 30, 3, 3000, 1),
      (4, 4, 'slipway-four', 'service', 4, 40, 100, 40, 4, 4000, 1),
      (5, 5, 'slipway-five', 'app', 5, 50, 100, 50, 5, 5000, 1)`
  )

  await sails.helpers.lookout.ensureObservabilitySchema()
  const sourceBeforeMaintenance = await source.sendNativeQuery(
    'SELECT COUNT(*) AS total FROM container_metrics'
  )
  expect(
    (sourceBeforeMaintenance.rows || sourceBeforeMaintenance)[0].total
  ).toBe(5)
  expect(await sails.models.containermetric.count()).toBe(0)
})

test('SQLite query plans use the observability time-shape indexes', async ({
  sails,
  expect
}) => {
  await sails.helpers.lookout.ensureObservabilitySchema()
  const database = sails.getDatastore('observability').manager
  const plans = [
    database
      .prepare(
        `EXPLAIN QUERY PLAN
        SELECT * FROM container_metrics
        WHERE environment = ? AND recorded_at >= ?
        ORDER BY recorded_at DESC`
      )
      .all(1, 0),
    database
      .prepare(
        `EXPLAIN QUERY PLAN
        SELECT * FROM container_metrics
        WHERE container_name = ? AND recorded_at >= ?
        ORDER BY recorded_at DESC`
      )
      .all('slipway-one', 0),
    database
      .prepare(
        `EXPLAIN QUERY PLAN
        SELECT * FROM telemetry_spans
        WHERE trace_id = ?
        ORDER BY started_at DESC`
      )
      .all('trace-1'),
    database
      .prepare(
        `EXPLAIN QUERY PLAN
        SELECT id FROM telemetry_metrics
        WHERE recorded_at < ?
        ORDER BY recorded_at ASC, id ASC
        LIMIT ?`
      )
      .all(Date.now(), 50)
  ]
  const details = plans.map((plan) => plan.map((row) => row.detail).join(' '))

  expect(details[0]).toContain('container_metrics_environment_recorded_at')
  expect(details[1]).toContain('container_metrics_container_recorded_at')
  expect(details[2]).toContain('telemetry_spans_trace_started_at')
  expect(details[3]).toContain('telemetry_metrics_recorded_at')
})

async function resetObservabilityHealth(sails) {
  await sails.models.observabilityjobhealth.destroy({})
  await clearTelemetry(sails)
}

async function clearTelemetry(sails) {
  await Promise.all([
    sails.models.containermetric.destroy({}),
    sails.models.telemetryspan.destroy({}),
    sails.models.telemetryexception.destroy({}),
    sails.models.telemetrymetric.destroy({}),
    sails.models.telemetryconnection.destroy({})
  ])
}

function replace(namespace, name, implementation) {
  implementation.with = implementation
  namespace[name] = implementation
}

function containerMetric({ environmentId, recordedAt }) {
  return {
    containerName: 'slipway-test-production',
    containerType: 'app',
    cpuPercent: 1,
    memoryUsage: 10,
    memoryLimit: 100,
    memoryPercent: 10,
    pids: 1,
    recordedAt,
    environment: environmentId
  }
}

function span({ environmentId, startedAt }) {
  return {
    traceId: `trace-${startedAt}`,
    spanId: `span-${startedAt}`,
    name: 'GET /health',
    duration: 1,
    startedAt,
    environment: String(environmentId)
  }
}

function exception({ environmentId, occurredAt }) {
  return {
    exceptionType: 'Error',
    message: 'Test error',
    occurredAt,
    environment: String(environmentId)
  }
}

function metric({ environmentId, recordedAt }) {
  return {
    name: 'test.metric',
    value: 1,
    recordedAt,
    environment: String(environmentId)
  }
}
