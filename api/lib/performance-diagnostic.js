function buildPerformanceDiagnostic({
  project,
  environment,
  containerName,
  containerType,
  configuredMemoryLimit,
  metrics,
  processSnapshot = null,
  generatedAt = Date.now()
}) {
  const samples = metrics
    .filter(
      (metric) =>
        Number.isFinite(metric.recordedAt) &&
        Number.isFinite(metric.memoryUsage) &&
        Number.isFinite(metric.memoryLimit) &&
        Number.isFinite(metric.memoryPercent) &&
        Number.isFinite(metric.cpuPercent)
    )
    .sort((a, b) => a.recordedAt - b.recordedAt)
  const first = samples[0]
  const latest = samples.at(-1)

  return {
    kind: 'slipway.container-performance-diagnostic',
    version: 2,
    generatedAt,
    scope: {
      project,
      environment,
      containerName,
      containerType
    },
    configuredMemoryLimit: configuredMemoryLimit || null,
    observation: {
      sampleCount: samples.length,
      firstSampleAt: first?.recordedAt ?? null,
      lastSampleAt: latest?.recordedAt ?? null,
      durationMinutes:
        first && latest
          ? Math.round((latest.recordedAt - first.recordedAt) / 60000)
          : 0,
      latestSampleAgeSeconds: latest
        ? Math.max(0, Math.round((generatedAt - latest.recordedAt) / 1000))
        : null
    },
    memory: latest
      ? {
          latestUsageMiB: toMiB(latest.memoryUsage),
          dockerLimitMiB: toMiB(latest.memoryLimit),
          latestPercent: latest.memoryPercent,
          firstUsageMiB: toMiB(first.memoryUsage),
          changeMiB: toMiB(latest.memoryUsage - first.memoryUsage),
          p95Percent: percentile(
            samples.map((sample) => sample.memoryPercent),
            0.95
          ),
          maxPercent: Math.max(...samples.map((sample) => sample.memoryPercent))
        }
      : null,
    cpu: latest
      ? {
          latestPercent: latest.cpuPercent,
          p95Percent: percentile(
            samples.map((sample) => sample.cpuPercent),
            0.95
          ),
          maxPercent: Math.max(...samples.map((sample) => sample.cpuPercent))
        }
      : null,
    processSnapshot,
    evidenceLimits: [
      'A process RSS snapshot includes shared pages and cannot be added up to explain Docker container memory.',
      'A rising container trend is not proof of a memory leak; compare after garbage collection and across comparable workloads.',
      'This packet does not include traffic, JavaScript heap profiles, restarts, or application logs.'
    ]
  }
}

function toMiB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}

module.exports = { buildPerformanceDiagnostic }
