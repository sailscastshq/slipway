/**
 * view-lookout.js
 *
 * Per-environment Lookout dashboard — shows containers for a specific
 * project/environment with sparkline history.
 */

module.exports = {
  friendlyName: 'View environment Lookout',

  description: 'Display the per-environment Lookout dashboard.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, envSlug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    if (!user) {
      throw { notFound: '/login' }
    }

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    }).decrypt()
    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Get app and services
    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))
    const services = await Service.find({
      environment: environment.id,
      status: 'running'
    })

    const containerNames = []
    if (app && app.containerName) containerNames.push(app.containerName)
    for (const s of services) {
      if (s.containerName) containerNames.push(s.containerName)
    }

    // Get latest metrics
    const latestMetrics =
      containerNames.length > 0
        ? await ContainerMetric.find({ containerName: containerNames })
            .sort('recordedAt DESC')
            .limit(containerNames.length * 2)
        : []

    const metricMap = {}
    for (const m of latestMetrics) {
      if (!metricMap[m.containerName]) {
        metricMap[m.containerName] = m
      }
    }

    // Get 1 hour of history for sparklines
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    const history =
      containerNames.length > 0
        ? await ContainerMetric.find({
            containerName: containerNames,
            recordedAt: { '>=': oneHourAgo }
          }).sort('recordedAt ASC')
        : []

    const historyMap = {}
    for (const m of history) {
      if (!historyMap[m.containerName]) historyMap[m.containerName] = []
      historyMap[m.containerName].push({
        cpu: m.cpuPercent,
        mem: m.memoryPercent,
        t: m.recordedAt
      })
    }

    // Build container list
    const containers = []

    if (app) {
      const metric = metricMap[app.containerName]
      containers.push({
        name: app.containerName,
        type: 'app',
        status: app.status,
        lastDeployedAt: app.lastDeployedAt,
        imageName: app.imageName,
        metric: metric
          ? {
              cpuPercent: metric.cpuPercent,
              memoryUsage: metric.memoryUsage,
              memoryLimit: metric.memoryLimit,
              memoryPercent: metric.memoryPercent,
              netIO: metric.netIO,
              blockIO: metric.blockIO,
              pids: metric.pids,
              recordedAt: metric.recordedAt
            }
          : null,
        history: historyMap[app.containerName] || []
      })
    }

    for (const service of services) {
      const metric = metricMap[service.containerName]
      containers.push({
        name: service.containerName,
        type: 'service',
        serviceType: service.type,
        serviceName: service.name,
        status: service.status,
        metric: metric
          ? {
              cpuPercent: metric.cpuPercent,
              memoryUsage: metric.memoryUsage,
              memoryLimit: metric.memoryLimit,
              memoryPercent: metric.memoryPercent,
              netIO: metric.netIO,
              blockIO: metric.blockIO,
              pids: metric.pids,
              recordedAt: metric.recordedAt
            }
          : null,
        history: historyMap[service.containerName] || []
      })
    }

    // Telemetry summary (last 1 hour)
    const telemetryCutoff = Date.now() - 60 * 60 * 1000
    const [recentSpans, recentExceptions, slowQueries, cacheMetrics] =
      await Promise.all([
        TelemetrySpan.find({
          environment: environment.id,
          startedAt: { '>=': telemetryCutoff }
        })
          .sort('startedAt DESC')
          .limit(500),
        TelemetryException.find({
          environment: environment.id,
          occurredAt: { '>=': telemetryCutoff }
        })
          .sort('occurredAt DESC')
          .limit(200),
        TelemetryMetric.find({
          environment: environment.id,
          name: 'db.query',
          recordedAt: { '>=': telemetryCutoff }
        })
          .sort('value DESC')
          .limit(50),
        TelemetryMetric.find({
          environment: environment.id,
          name: ['cache.hit', 'cache.miss', 'cache.write', 'cache.delete'],
          recordedAt: { '>=': telemetryCutoff }
        })
          .sort('recordedAt DESC')
          .limit(500)
      ])

    // Compute telemetry stats
    const totalRequests = recentSpans.length
    const errorRequests = recentSpans.filter((s) => s.statusCode >= 500).length
    const durations = recentSpans.map((s) => s.duration).sort((a, b) => a - b)
    const p95Duration =
      durations.length > 0
        ? durations[Math.ceil(durations.length * 0.95) - 1]
        : 0
    const avgDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0
    const flagComparisons = summarizeFeatureFlags(
      recentSpans,
      app?.id,
      recentExceptions
    )

    // Group exceptions by type+message
    const exceptionGroups = {}
    for (const ex of recentExceptions) {
      const key = `${ex.exceptionType}::${ex.message}`
      if (!exceptionGroups[key]) {
        exceptionGroups[key] = {
          exceptionType: ex.exceptionType,
          message: ex.message,
          count: 0,
          lastSeen: ex.occurredAt,
          lastStackTrace: ex.stackTrace,
          lastUrl: ex.url,
          lastMethod: ex.method
        }
      }
      exceptionGroups[key].count++
    }

    // Cache aggregation
    const cacheHits = cacheMetrics.filter((m) => m.name === 'cache.hit').length
    const cacheMisses = cacheMetrics.filter(
      (m) => m.name === 'cache.miss'
    ).length
    const cacheWrites = cacheMetrics.filter(
      (m) => m.name === 'cache.write'
    ).length
    const cacheDeletes = cacheMetrics.filter(
      (m) => m.name === 'cache.delete'
    ).length
    const cacheTotalOps = cacheMetrics.length
    const cacheHitMissTotal = cacheHits + cacheMisses

    // Top keys by frequency with per-key hit/miss counts
    const keyStats = {}
    for (const m of cacheMetrics) {
      const key =
        m.attributes && m.attributes.key ? m.attributes.key : 'unknown'
      if (!keyStats[key]) keyStats[key] = { key, hits: 0, misses: 0, total: 0 }
      keyStats[key].total++
      if (m.name === 'cache.hit') keyStats[key].hits++
      if (m.name === 'cache.miss') keyStats[key].misses++
    }
    const cacheTopKeys = Object.values(keyStats)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    const telemetry = {
      requests: {
        total: totalRequests,
        errors: errorRequests,
        errorRate:
          totalRequests > 0
            ? ((errorRequests / totalRequests) * 100).toFixed(1)
            : '0',
        p95: Math.round(p95Duration),
        avg: Math.round(avgDuration),
        recent: recentSpans.slice(0, 20).map((s) => ({
          name: s.name,
          method: s.method,
          url: s.url,
          statusCode: s.statusCode,
          duration: s.duration,
          startedAt: s.startedAt,
          traceId: s.traceId,
          attributes: s.attributes || {}
        }))
      },
      exceptions: {
        total: recentExceptions.length,
        groups: Object.values(exceptionGroups)
          .sort((a, b) => b.count - a.count)
          .slice(0, 20)
      },
      queries: {
        slow: slowQueries.slice(0, 20).map((q) => ({
          value: q.value,
          attributes: q.attributes,
          recordedAt: q.recordedAt
        })),
        total: slowQueries.length
      },
      cache: {
        totalOps: cacheTotalOps,
        hits: cacheHits,
        misses: cacheMisses,
        hitRate:
          cacheHitMissTotal > 0
            ? ((cacheHits / cacheHitMissTotal) * 100).toFixed(1)
            : '0',
        writes: cacheWrites,
        deletes: cacheDeletes,
        topKeys: cacheTopKeys,
        recent: cacheMetrics.slice(0, 20).map((m) => ({
          name: m.name,
          key: m.attributes && m.attributes.key ? m.attributes.key : 'unknown',
          duration: m.value,
          recordedAt: m.recordedAt
        }))
      },
      flags: flagComparisons,
      hasTelemetry:
        recentSpans.length > 0 ||
        recentExceptions.length > 0 ||
        cacheMetrics.length > 0 ||
        slowQueries.length > 0,
      telemetryToken: environment.telemetryToken
    }

    return {
      page: 'projects/lookout',
      props: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug
        },
        appName: app ? app.name : project.name,
        containers,
        telemetry
      }
    }
  }
}

function summarizeFeatureFlags(spans, appId, exceptions = []) {
  const summaries = new Map()
  const exceptionCounts = new Map()
  for (const exception of exceptions) {
    if (!exception.traceId) continue
    exceptionCounts.set(
      exception.traceId,
      (exceptionCounts.get(exception.traceId) || 0) + 1
    )
  }

  for (const span of spans) {
    const spanAppId = span.attributes?.['feature.app_id']
    if (spanAppId && String(spanAppId) !== String(appId)) continue
    const evaluations = span.attributes?.['feature.flags']
    if (!evaluations || typeof evaluations !== 'object') continue

    for (const [key, evaluation] of Object.entries(evaluations)) {
      if (!summaries.has(key)) {
        summaries.set(key, {
          key,
          on: { requests: 0, errors: 0, exceptions: 0, duration: 0 },
          off: { requests: 0, errors: 0, exceptions: 0, duration: 0 }
        })
      }
      const group = evaluation?.value === true ? 'on' : 'off'
      const bucket = summaries.get(key)[group]
      bucket.requests++
      if (span.statusCode >= 500) bucket.errors++
      bucket.exceptions += exceptionCounts.get(span.traceId) || 0
      bucket.duration += Number(span.duration || 0)
    }
  }

  return [...summaries.values()]
    .map((summary) => ({
      key: summary.key,
      on: presentFlagBucket(summary.on),
      off: presentFlagBucket(summary.off)
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function presentFlagBucket(bucket) {
  return {
    requests: bucket.requests,
    exceptions: bucket.exceptions,
    errorRate:
      bucket.requests > 0
        ? Number(((bucket.errors / bucket.requests) * 100).toFixed(1))
        : null,
    avg:
      bucket.requests > 0 ? Math.round(bucket.duration / bucket.requests) : null
  }
}
