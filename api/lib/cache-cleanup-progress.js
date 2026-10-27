// Only the registered manual request can claim the helper's current progress.
// A scheduled or concurrent held run must never be attached to another request.
async function read(sails, requestId) {
  const record = await sails.models.setting.findOne({
    key: 'buildCacheRetentionLastRun'
  })
  try {
    if (!record?.value || Buffer.byteLength(record.value) > 32768) return null
    const value = JSON.parse(record.value)
    if (
      value.requestId !== requestId ||
      ![
        'checking',
        'pruning',
        'refreshing',
        'complete',
        'held',
        'dry-run',
        'failed',
        'unconfirmed'
      ].includes(value.phase)
    )
      return null
    return {
      phase: value.phase,
      startedAt: value.startedAt,
      updatedAt: value.updatedAt,
      dockerReportedReclaimed:
        typeof value.dockerReportedReclaimed === 'string'
          ? value.dockerReportedReclaimed.slice(0, 100)
          : null,
      filesystemAvailableDeltaBytes: Number.isSafeInteger(
        value.filesystemAvailableDeltaBytes
      )
        ? value.filesystemAvailableDeltaBytes
        : null,
      error:
        typeof value.error === 'string' ? value.error.slice(0, 1024) : null,
      holds: Array.isArray(value.holds)
        ? value.holds
            .filter((v) => typeof v === 'string')
            .slice(0, 10)
            .map((v) => v.slice(0, 150))
        : []
    }
  } catch {
    return null
  }
}
module.exports = { read }
