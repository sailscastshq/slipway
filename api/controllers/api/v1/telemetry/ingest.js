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
    }
  },

  exits: {
    success: { statusCode: 200 },
    unauthorized: { statusCode: 401, description: 'Invalid or missing telemetry token' },
    badRequest: { statusCode: 400, description: 'Invalid payload' }
  },

  fn: async function ({ spans, exceptions, metrics }) {
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
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const environment = await Environment.findOne({ telemetryTokenHash: tokenHash })
    if (!environment) {
      throw 'unauthorized'
    }

    const environmentId = environment.id
    const now = Date.now()
    let ingested = { spans: 0, exceptions: 0, metrics: 0 }

    // Ingest spans
    if (Array.isArray(spans) && spans.length > 0) {
      const spanRecords = spans.slice(0, 500).map(s => ({
        traceId: String(s.traceId || ''),
        spanId: String(s.spanId || ''),
        parentSpanId: s.parentSpanId || null,
        name: String(s.name || 'unknown'),
        kind: ['server', 'client', 'internal'].includes(s.kind) ? s.kind : 'server',
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
      const exceptionRecords = exceptions.slice(0, 200).map(e => ({
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
      const metricRecords = metrics.slice(0, 1000).map(m => ({
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

    return ingested
  }
}
