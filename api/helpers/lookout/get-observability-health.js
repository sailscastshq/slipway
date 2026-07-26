const EXPECTED_INTERVALS = {
  collector: 30 * 1000,
  retention: 5 * 60 * 1000
}

module.exports = {
  friendlyName: 'Get observability health',

  description:
    'Return collector and retention freshness, failures, and retained row counts.',

  inputs: {
    now: {
      type: 'number',
      defaultsTo: 0
    }
  },

  fn: async function ({ now }) {
    const currentTime = now || Date.now()
    const records = await ObservabilityJobHealth.find({
      jobName: Object.keys(EXPECTED_INTERVALS)
    })
    const byName = Object.fromEntries(
      records.map((record) => [record.jobName, record])
    )

    return Object.fromEntries(
      Object.entries(EXPECTED_INTERVALS).map(([jobName, expectedInterval]) => {
        const record = byName[jobName]
        if (!record) {
          return [
            jobName,
            {
              status: 'waiting',
              lastSuccessAt: null,
              lastFailureAt: null,
              lagMs: null,
              rowCount: 0,
              details: {}
            }
          ]
        }

        const lagMs = record.lastSuccessAt
          ? Math.max(0, currentTime - record.lastSuccessAt)
          : null
        const failed =
          record.lastFailureAt &&
          (!record.lastSuccessAt || record.lastFailureAt > record.lastSuccessAt)
        const stale = lagMs !== null && lagMs > expectedInterval * 3

        return [
          jobName,
          {
            status: failed ? 'failed' : stale ? 'stale' : 'healthy',
            lastAttemptAt: record.lastAttemptAt,
            lastSuccessAt: record.lastSuccessAt,
            lastFailureAt: record.lastFailureAt,
            lastError: record.lastError,
            lastDurationMs: record.lastDurationMs,
            lagMs,
            rowCount: record.rowCount,
            details: record.details || {}
          }
        ]
      })
    )
  }
}
