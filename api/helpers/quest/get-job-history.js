module.exports = {
  friendlyName: 'Get Quest job history',

  description:
    'Query recent job run history from telemetry for an environment.',

  inputs: {
    environmentId: {
      type: 'number',
      required: true,
      description: 'Environment ID to query telemetry for'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ environmentId }) {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recentMetrics = await TelemetryMetric.find({
      environment: environmentId,
      name: { startsWith: 'quest.job.' },
      recordedAt: { '>=': since }
    })
      .sort('recordedAt DESC')
      .limit(500)

    // These are uncorrelated legacy events, not a reconstructed run ledger.
    const terminalAliases = new Map([
      ['complete', 'completed'],
      ['error', 'failed']
    ])
    return recentMetrics.map((m) => ({
      event:
        terminalAliases.get(m.name.slice('quest.job.'.length)) ||
        m.name.slice('quest.job.'.length),
      legacy: true,
      eventId: m.id,
      jobName: m.attributes.jobName,
      duration: m.value,
      error: m.attributes.error || null,
      stdout: m.attributes.stdout || null,
      stderr: m.attributes.stderr || null,
      trigger: m.attributes.trigger || 'scheduled',
      recordedAt: m.recordedAt
    }))
  }
}
