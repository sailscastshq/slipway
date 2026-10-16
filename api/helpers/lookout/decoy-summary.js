module.exports = {
  friendlyName: 'Decoy summary',
  inputs: { environmentId: { type: 'string', required: true } },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ environmentId }) {
    const apps = await App.find({ environment: environmentId })
    const names = new Map(apps.map((a) => [String(a.id), a.name]))
    const metrics = await TelemetryMetric.find({
      environment: environmentId,
      name: 'lookout.decoy_hit',
      recordedAt: { '>=': Date.now() - 60 * 60 * 1000 }
    })
      .sort('recordedAt DESC')
      .limit(1000)
    const groups = new Map()
    for (const m of metrics) {
      const a = m.attributes
      if (a?.kind !== 'decoy_hit' || !names.has(a.appId)) continue
      const key = `${a.appId}|${a.path}|${a.method}|${a.statusCode}`
      if (!groups.has(key))
        groups.set(key, {
          appId: a.appId,
          appName: names.get(a.appId),
          path: a.path,
          method: a.method,
          statusCode: a.statusCode,
          lastSeenAt: m.recordedAt,
          observed: 0
        })
      groups.get(key).observed++
    }
    return {
      groups: [...groups.values()],
      window: 'Last hour',
      capped: metrics.length === 1000
    }
  }
}
