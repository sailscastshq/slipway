const path = require('node:path')

const { test } = require('sounding')

const productionConfigPath = path.resolve(
  __dirname,
  '../../../config/env/production.js'
)

test('production custom config keeps the public URL and domain settings together', ({
  expect
}) => {
  const originalSlipwayUrl = process.env.SLIPWAY_URL
  process.env.SLIPWAY_URL = 'https://slipway.example.com'
  delete require.cache[productionConfigPath]

  try {
    const productionConfig = require(productionConfigPath)

    expect(productionConfig.custom.baseUrl).toBe('https://slipway.example.com')
    expect(productionConfig.custom.slipwayDomain).toBe(null)
  } finally {
    delete require.cache[productionConfigPath]
    if (originalSlipwayUrl === undefined) {
      delete process.env.SLIPWAY_URL
    } else {
      process.env.SLIPWAY_URL = originalSlipwayUrl
    }
  }
})

test('production observability retention has documented defaults and positive overrides', ({
  expect
}) => {
  const names = [
    'SLIPWAY_CONTAINER_METRICS_RETENTION_HOURS',
    'SLIPWAY_APPLICATION_TELEMETRY_RETENTION_DAYS',
    'SLIPWAY_OBSERVABILITY_PRUNE_BATCH_SIZE',
    'SLIPWAY_OBSERVABILITY_MAX_PRUNE_BATCHES'
  ]
  const original = Object.fromEntries(
    names.map((name) => [name, process.env[name]])
  )

  try {
    process.env.SLIPWAY_CONTAINER_METRICS_RETENTION_HOURS = '12'
    process.env.SLIPWAY_APPLICATION_TELEMETRY_RETENTION_DAYS = '3'
    process.env.SLIPWAY_OBSERVABILITY_PRUNE_BATCH_SIZE = '250'
    process.env.SLIPWAY_OBSERVABILITY_MAX_PRUNE_BATCHES = '8'
    delete require.cache[productionConfigPath]

    const productionConfig = require(productionConfigPath)
    expect(productionConfig.custom.observability).toEqual({
      containerMetricsRetentionMs: 12 * 60 * 60 * 1000,
      applicationTelemetryRetentionMs: 3 * 24 * 60 * 60 * 1000,
      pruneBatchSize: 250,
      maxPruneBatchesPerRun: 8
    })
  } finally {
    delete require.cache[productionConfigPath]
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name]
      else process.env[name] = original[name]
    }
  }
})
