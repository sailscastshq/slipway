module.exports = {
  hookTimeout: 80000,

  custom: {
    baseUrl: process.env.SLIPWAY_URL,
    slipwayDomain: null,
    slipwayPortRange: {
      start: Number(process.env.SLIPWAY_APP_PORT_START) || 1338,
      end: Number(process.env.SLIPWAY_APP_PORT_END) || 1500
    },
    observability: {
      containerMetricsRetentionMs:
        positiveNumber(
          process.env.SLIPWAY_CONTAINER_METRICS_RETENTION_HOURS,
          24
        ) *
        60 *
        60 *
        1000,
      applicationTelemetryRetentionMs:
        positiveNumber(
          process.env.SLIPWAY_APPLICATION_TELEMETRY_RETENTION_DAYS,
          7
        ) *
        24 *
        60 *
        60 *
        1000,
      pruneBatchSize: positiveInteger(
        process.env.SLIPWAY_OBSERVABILITY_PRUNE_BATCH_SIZE,
        500
      ),
      maxPruneBatchesPerRun: positiveInteger(
        process.env.SLIPWAY_OBSERVABILITY_MAX_PRUNE_BATCHES,
        20
      )
    },
    helm: {
      timeoutMs: positiveInteger(
        process.env.SLIPWAY_HELM_TIMEOUT_MS,
        30 * 1000
      ),
      processGraceMs: 2 * 1000,
      maxSourceBytes: 64 * 1024,
      maxLogBytes: 64 * 1024,
      maxResultBytes: 128 * 1024,
      maxProcessOutputBytes: 256 * 1024,
      maxProcessStderrBytes: 64 * 1024,
      killGraceMs: 250,
      writeArmTtlMs:
        positiveInteger(process.env.SLIPWAY_HELM_WRITE_ARM_TTL_SECONDS, 60) *
        1000,
      historyRetentionMs:
        positiveInteger(process.env.SLIPWAY_HELM_HISTORY_RETENTION_DAYS, 30) *
        24 *
        60 *
        60 *
        1000,
      historyMaxEntriesPerScope: positiveInteger(
        process.env.SLIPWAY_HELM_HISTORY_MAX_ENTRIES,
        200
      ),
      auditRetentionMs:
        positiveInteger(process.env.SLIPWAY_HELM_AUDIT_RETENTION_DAYS, 90) *
        24 *
        60 *
        60 *
        1000,
      auditMaxEntriesPerTeam: positiveInteger(
        process.env.SLIPWAY_HELM_AUDIT_MAX_ENTRIES,
        5000
      )
    }
  },

  models: {
    migrate: process.env.SLIPWAY_MIGRATE || 'safe',
    dataEncryptionKeys: {
      default: process.env.DATA_ENCRYPTION_KEY
    }
  },

  blueprints: {
    shortcuts: false
  },

  session: {
    secret: process.env.SESSION_SECRET,
    cookie: {
      secure: process.env.SLIPWAY_SSL === 'true',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  },

  sockets: {
    onlyAllowOrigins: [process.env.SLIPWAY_URL]
  },

  log: {
    level: 'info'
  },

  http: {
    trustProxy: true,
    cache: 365.25 * 24 * 60 * 60 * 1000
  }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function positiveInteger(value, fallback) {
  return Math.floor(positiveNumber(value, fallback))
}
