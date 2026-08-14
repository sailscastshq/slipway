/**
 * POST /api/v1/telemetry/ingest
 *
 * Receives telemetry data (spans, exceptions, metrics) from deployed apps
 * running sails-hook-slipway. Authenticates via environment telemetry token.
 *
 * This endpoint is public (no session auth) — authentication is done via
 * Bearer token matching an environment's telemetryToken.
 */

module.exports = {
  friendlyName: 'Ingest telemetry',

  description: 'Receive and store telemetry data from deployed applications.',

  inputs: {
    spans: {
      type: 'ref',
      description: 'Array of request span objects'
    },
    exceptions: {
      type: 'ref',
      description: 'Array of exception objects'
    },
    metrics: {
      type: 'ref',
      description: 'Array of metric objects'
    },
    registration: {
      type: 'ref',
      description: 'Runtime registration and heartbeat from sails-hook-slipway'
    }
  },

  exits: {
    success: { statusCode: 200 },
    unauthorized: {
      statusCode: 401,
      description: 'Invalid or missing telemetry token'
    },
    badRequest: { statusCode: 400, description: 'Invalid payload' }
  },

  fn: async function ({ spans, exceptions, metrics, registration }) {
    // Authenticate via Bearer token
    const authHeader = this.req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw 'unauthorized'
    }

    const token = authHeader.slice(7)
    if (!token || !token.startsWith('stk_')) {
      throw 'unauthorized'
    }

    // Look up the environment by token hash (can't query encrypted fields directly)
    const crypto = require('crypto')
    const randomId = () => crypto.randomBytes(16).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const environment = await Environment.findOne({
      telemetryTokenHash: tokenHash
    })
    if (!environment) {
      throw 'unauthorized'
    }

    const environmentId = environment.id
    const now = Date.now()
    let ingested = { spans: 0, exceptions: 0, metrics: 0 }

    const connection = await registerTelemetryRuntime({
      registration,
      environmentId,
      now
    })

    // Ingest spans
    if (Array.isArray(spans) && spans.length > 0) {
      const spanRecords = spans.slice(0, 500).map((s) => ({
        traceId: String(s.traceId || randomId()),
        spanId: String(s.spanId || randomId()),
        parentSpanId: s.parentSpanId || null,
        name: String(s.name || 'unknown'),
        kind: ['server', 'client', 'internal'].includes(s.kind)
          ? s.kind
          : 'server',
        method: s.method || null,
        url: s.url || null,
        statusCode: typeof s.statusCode === 'number' ? s.statusCode : null,
        duration: typeof s.duration === 'number' ? s.duration : 0,
        startedAt: typeof s.startedAt === 'number' ? s.startedAt : now,
        attributes: (typeof s.attributes === 'object' && s.attributes) || {},
        environment: environmentId
      }))
      await TelemetrySpan.createEach(spanRecords)
      ingested.spans = spanRecords.length
    }

    // Ingest exceptions
    if (Array.isArray(exceptions) && exceptions.length > 0) {
      const exceptionRecords = exceptions.slice(0, 200).map((e) => ({
        exceptionType: String(e.exceptionType || e.type || 'Error'),
        message: String(e.message || 'Unknown error'),
        stackTrace: e.stackTrace || e.stack || null,
        handled: Boolean(e.handled),
        method: e.method || null,
        url: e.url || null,
        traceId: e.traceId || null,
        occurredAt: typeof e.occurredAt === 'number' ? e.occurredAt : now,
        environment: environmentId
      }))
      await TelemetryException.createEach(exceptionRecords)
      ingested.exceptions = exceptionRecords.length
    }

    // Ingest metrics
    if (Array.isArray(metrics) && metrics.length > 0) {
      const metricRecords = metrics.slice(0, 1000).map((m) => ({
        name: String(m.name || 'unknown'),
        value: typeof m.value === 'number' ? m.value : 0,
        unit: String(m.unit || 'ms'),
        attributes: (typeof m.attributes === 'object' && m.attributes) || {},
        recordedAt: typeof m.recordedAt === 'number' ? m.recordedAt : now,
        environment: environmentId
      }))
      await TelemetryMetric.createEach(metricRecords)
      ingested.metrics = metricRecords.length
    }

    if (connection) {
      ingested.registration = true
      const app = await App.findOne({ id: connection.app })
      const hasRecentData =
        ingested.spans > 0 || ingested.exceptions > 0 || ingested.metrics > 0
      const telemetryState = sails.helpers.lookout.resolveTelemetryState.with({
        detectedFeature: environment.features?.['sails-hook-slipway'],
        connection,
        currentDeploymentId: app?.currentDeployment
          ? String(app.currentDeployment)
          : undefined,
        hasRecentData,
        now,
        staleAfterMs:
          sails.config.custom.observability.telemetryConnectionStaleMs
      })
      sails.sse?.publish(`lookout:env:${environmentId}`, { telemetryState })
    }

    return ingested
  }
}

async function registerTelemetryRuntime({ registration, environmentId, now }) {
  if (!registration || typeof registration !== 'object') return null

  const appId = String(registration.appId || '').trim()
  const hookVersion = String(registration.hookVersion || '').trim()
  const protocolVersion = Number(registration.protocolVersion)
  if (!appId || !hookVersion || !Number.isInteger(protocolVersion)) return null

  const app = await App.findOne({ id: appId, environment: environmentId })
  if (!app) return null

  const deploymentId = registration.deploymentId
    ? String(registration.deploymentId)
    : null
  if (deploymentId) {
    const deployment = await Deployment.findOne({
      id: deploymentId,
      environment: environmentId,
      app: app.id
    })
    if (!deployment) return null
  }

  const existing = await TelemetryConnection.findOne({ app: String(app.id) })
  if (
    existing?.deployment &&
    deploymentId &&
    Number(existing.deployment) > Number(deploymentId)
  ) {
    return existing
  }

  const values = {
    app: String(app.id),
    environment: String(environmentId),
    deployment: deploymentId,
    hookVersion: hookVersion.slice(0, 64),
    protocolVersion,
    capabilities:
      registration.capabilities &&
      typeof registration.capabilities === 'object' &&
      !Array.isArray(registration.capabilities)
        ? registration.capabilities
        : {},
    enabled: registration.enabled !== false,
    startedAt:
      typeof registration.startedAt === 'number' ? registration.startedAt : now,
    lastSeenAt: now
  }

  if (existing) {
    return TelemetryConnection.updateOne({ id: existing.id }).set(values)
  }
  return TelemetryConnection.create(values).fetch()
}
