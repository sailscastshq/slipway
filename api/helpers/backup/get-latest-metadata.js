module.exports = {
  friendlyName: 'Get latest backup metadata',
  description:
    'Read bounded display metadata for services already authorized by the caller.',
  inputs: { serviceIds: { type: 'json', required: true } },
  fn: async function ({ serviceIds }) {
    const ids = [...new Set(serviceIds)]
    if (!ids.length) return {}
    // Rank inside SQLite: never load complete histories (or storage credentials)
    // into the page process. A service contributes at most two small rows.
    const result = await Backup.getDatastore().sendNativeQuery(
      `SELECT id, service, status, completed_at, size_bytes, attempt_rank, success_rank
       FROM (
         SELECT id, service, status, completed_at, size_bytes,
           ROW_NUMBER() OVER (PARTITION BY service ORDER BY created_at DESC, id ASC) AS attempt_rank,
           ROW_NUMBER() OVER (PARTITION BY service ORDER BY (status = 'completed') DESC, completed_at DESC, id ASC) AS success_rank
         FROM backups WHERE service IN (${ids.map(() => '?').join(',')})
       ) WHERE attempt_rank = 1 OR (status = 'completed' AND success_rank = 1)`,
      ids
    )
    const metadata = {}
    for (const row of result.rows) {
      const entry = (metadata[row.service] ||= {
        lastBackup: null,
        lastSuccessfulBackup: null
      })
      if (row.attempt_rank === 1)
        entry.lastBackup = {
          id: row.id,
          status: row.status,
          completedAt: row.completed_at,
          sizeBytes: row.size_bytes
        }
      if (row.status === 'completed' && row.success_rank === 1)
        entry.lastSuccessfulBackup = {
          completedAt: row.completed_at,
          sizeBytes: row.size_bytes
        }
    }
    for (const entry of Object.values(metadata)) {
      // Preserve the existing latest-attempt fast path, even if an older
      // completed record has a later completedAt (for example imported history).
      if (entry.lastBackup?.status === 'completed')
        entry.lastSuccessfulBackup = {
          completedAt: entry.lastBackup.completedAt,
          sizeBytes: entry.lastBackup.sizeBytes
        }
    }
    return metadata
  }
}
