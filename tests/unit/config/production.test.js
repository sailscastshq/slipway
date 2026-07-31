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

test('production ingress keeps app ports private unless direct access is explicit', ({
  expect
}) => {
  const names = ['SLIPWAY_APP_PORT_HOST', 'SLIPWAY_INGRESS']
  const original = Object.fromEntries(
    names.map((name) => [name, process.env[name]])
  )

  try {
    delete process.env.SLIPWAY_APP_PORT_HOST
    delete process.env.SLIPWAY_INGRESS
    delete require.cache[productionConfigPath]

    let productionConfig = require(productionConfigPath)
    expect(productionConfig.custom.slipwayPortHost).toBe('127.0.0.1')
    expect(productionConfig.custom.slipwayIngress).toBe('public')

    process.env.SLIPWAY_APP_PORT_HOST = '0.0.0.0'
    process.env.SLIPWAY_INGRESS = 'cloudflare-tunnel'
    delete require.cache[productionConfigPath]

    productionConfig = require(productionConfigPath)
    expect(productionConfig.custom.slipwayPortHost).toBe('0.0.0.0')
    expect(productionConfig.custom.slipwayIngress).toBe('cloudflare-tunnel')
  } finally {
    delete require.cache[productionConfigPath]
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name]
      else process.env[name] = original[name]
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

test('production Helm history has bounded configurable retention', ({
  expect
}) => {
  const names = [
    'SLIPWAY_HELM_HISTORY_RETENTION_DAYS',
    'SLIPWAY_HELM_HISTORY_MAX_ENTRIES',
    'SLIPWAY_HELM_WRITE_ARM_TTL_SECONDS',
    'SLIPWAY_HELM_AUDIT_RETENTION_DAYS',
    'SLIPWAY_HELM_AUDIT_MAX_ENTRIES'
  ]
  const original = Object.fromEntries(
    names.map((name) => [name, process.env[name]])
  )

  try {
    process.env.SLIPWAY_HELM_HISTORY_RETENTION_DAYS = '14'
    process.env.SLIPWAY_HELM_HISTORY_MAX_ENTRIES = '80'
    process.env.SLIPWAY_HELM_WRITE_ARM_TTL_SECONDS = '45'
    process.env.SLIPWAY_HELM_AUDIT_RETENTION_DAYS = '120'
    process.env.SLIPWAY_HELM_AUDIT_MAX_ENTRIES = '2400'
    delete require.cache[productionConfigPath]

    const productionConfig = require(productionConfigPath)
    expect(productionConfig.custom.helm.historyRetentionMs).toBe(
      14 * 24 * 60 * 60 * 1000
    )
    expect(productionConfig.custom.helm.historyMaxEntriesPerScope).toBe(80)
    expect(productionConfig.custom.helm.writeArmTtlMs).toBe(45 * 1000)
    expect(productionConfig.custom.helm.auditRetentionMs).toBe(
      120 * 24 * 60 * 60 * 1000
    )
    expect(productionConfig.custom.helm.auditMaxEntriesPerTeam).toBe(2400)
  } finally {
    delete require.cache[productionConfigPath]
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name]
      else process.env[name] = original[name]
    }
  }
})
