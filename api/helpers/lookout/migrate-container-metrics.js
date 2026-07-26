const MIGRATION_BATCH_SIZE = 50

module.exports = {
  friendlyName: 'Migrate container metrics',

  description:
    'Copy legacy container metrics from the application datastore into observability without duplicating rows after a restart.',

  inputs: {},

  fn: async function () {
    const source = sails.getDatastore()
    const destination = sails.getDatastore('observability')
    const sourceTable = await source.sendNativeQuery(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'container_metrics'"
    )

    if (rows(sourceTable).length === 0) {
      return { migrated: 0, sourceRowsRemaining: 0 }
    }

    const sourceColumns = await source.sendNativeQuery(
      'PRAGMA table_info(container_metrics)'
    )
    if (
      rows(sourceColumns).some((column) => column.name === 'legacy_source_id')
    ) {
      return { migrated: 0, sourceRowsRemaining: 0 }
    }

    const sourceCountResult = await source.sendNativeQuery(
      'SELECT COUNT(*) AS total FROM container_metrics'
    )
    const sourceCount = Number(rows(sourceCountResult)[0]?.total || 0)
    if (sourceCount === 0) {
      return { migrated: 0, sourceRowsRemaining: 0 }
    }

    let lastId = 0
    let copied = 0

    while (true) {
      const batchResult = await source.sendNativeQuery(
        `SELECT
          id, created_at, updated_at, container_name, container_type,
          cpu_percent, memory_usage, memory_limit, memory_percent, net_io,
          block_io, pids, recorded_at, environment, app, service
        FROM container_metrics
        WHERE id > ?
        ORDER BY id ASC
        LIMIT ?`,
        [lastId, MIGRATION_BATCH_SIZE]
      )
      const batch = rows(batchResult)
      if (batch.length === 0) break

      const placeholders = batch.map(
        () => `(${Array(16).fill('?').join(', ')})`
      )
      const values = []
      for (const row of batch) {
        values.push(
          row.id,
          row.created_at,
          row.updated_at,
          row.container_name,
          row.container_type,
          row.cpu_percent,
          row.memory_usage,
          row.memory_limit,
          row.memory_percent,
          row.net_io,
          row.block_io,
          row.pids,
          row.recorded_at,
          row.environment,
          row.app,
          row.service
        )
      }

      await destination.sendNativeQuery(
        `INSERT OR IGNORE INTO container_metrics (
          legacy_source_id, created_at, updated_at, container_name,
          container_type, cpu_percent, memory_usage, memory_limit,
          memory_percent, net_io, block_io, pids, recorded_at, environment,
          app, service
        ) VALUES ${placeholders.join(', ')}`,
        values
      )

      copied += batch.length
      lastId = batch[batch.length - 1].id
    }

    const verifiedResult = await destination.sendNativeQuery(
      'SELECT COUNT(*) AS total FROM container_metrics WHERE legacy_source_id IS NOT NULL'
    )
    const verifiedCount = Number(rows(verifiedResult)[0]?.total || 0)

    if (verifiedCount < sourceCount) {
      throw new Error(
        `Container metric migration copied ${verifiedCount} of ${sourceCount} legacy rows`
      )
    }

    await source.sendNativeQuery('DELETE FROM container_metrics')

    return {
      migrated: copied,
      sourceRowsRemaining: 0
    }
  }
}

function rows(result) {
  return result.rows || result || []
}
