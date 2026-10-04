module.exports = {
  friendlyName: 'Prune observability',

  description:
    'Delete expired infrastructure and application telemetry in bounded SQLite batches.',

  inputs: {
    now: {
      type: 'number',
      required: true
    },
    containerRetentionMs: {
      type: 'number',
      required: true
    },
    telemetryRetentionMs: {
      type: 'number',
      required: true
    },
    batchSize: {
      type: 'number',
      required: true
    },
    maxBatches: {
      type: 'number',
      required: true
    }
  },

  fn: async function ({
    now,
    containerRetentionMs,
    telemetryRetentionMs,
    batchSize,
    maxBatches
  }) {
    const datastore = sails.getDatastore('observability')
    const safeBatchSize = Math.max(1, Math.min(900, Math.floor(batchSize)))
    const safeMaxBatches = Math.max(1, Math.floor(maxBatches))
    const tables = [
      {
        key: 'questRuns',
        table: 'quest_runs',
        timestamp: 'requested_at',
        cutoff: now - Math.min(telemetryRetentionMs, 7 * 86400000)
      },
      {
        key: 'resourceAlertDeliveries',
        table: 'resource_alert_deliveries',
        timestamp: 'observed_at',
        cutoff: now - telemetryRetentionMs,
        terminalOnly: true
      },
      {
        key: 'containerMetrics',
        table: 'container_metrics',
        timestamp: 'recorded_at',
        cutoff: now - containerRetentionMs
      },
      {
        key: 'resourceAlertStates',
        table: 'resource_alert_states',
        timestamp: 'last_sample_at',
        cutoff: now - telemetryRetentionMs
      },
      {
        key: 'spans',
        table: 'telemetry_spans',
        timestamp: 'created_at',
        cutoff: now - telemetryRetentionMs
      },
      {
        key: 'exceptions',
        table: 'telemetry_exceptions',
        timestamp: 'created_at',
        cutoff: now - telemetryRetentionMs
      },
      {
        key: 'metrics',
        table: 'telemetry_metrics',
        timestamp: 'created_at',
        cutoff: now - telemetryRetentionMs
      }
    ]

    const result = {
      deletedRows: 0,
      rowCount: 0,
      hasBacklog: false,
      retentionLagMs: 0,
      tables: {}
    }

    for (const spec of tables) {
      // Keep the latest receipt for an active incident. Otherwise retention
      // could make a long-running incident look like an unnotified legacy row.
      const deliveryFilter = spec.terminalOnly
        ? `AND status <> 'pending'
        AND NOT EXISTS (SELECT 1 FROM resource_alert_states s
          WHERE s.container_name=resource_alert_deliveries.container_name
          AND ((resource='cpu' AND CAST(s.cpu_active AS INTEGER)=1) OR (resource='memory' AND CAST(s.memory_active AS INTEGER)=1))
          AND resource_alert_deliveries.id=(SELECT d.id FROM resource_alert_deliveries d
            WHERE d.container_name=resource_alert_deliveries.container_name AND d.resource=resource_alert_deliveries.resource
            ORDER BY d.observed_at DESC, d.id DESC LIMIT 1))`
        : ''
      let deletedRows = 0
      let batches = 0

      while (batches < safeMaxBatches) {
        const expiredResult = await datastore.sendNativeQuery(
          `SELECT id
          FROM ${spec.table}
          WHERE ${spec.timestamp} < ? ${deliveryFilter}
          ORDER BY ${spec.timestamp} ASC, id ASC
          LIMIT ?`,
          [spec.cutoff, safeBatchSize]
        )
        const expired = rows(expiredResult)
        if (expired.length === 0) break

        const ids = expired.map((row) => row.id)
        await datastore.sendNativeQuery(
          `DELETE FROM ${spec.table}
          WHERE id IN (${ids.map(() => '?').join(', ')})`,
          ids
        )

        deletedRows += ids.length
        batches += 1
        if (ids.length < safeBatchSize) break
      }

      const [countResult, backlogResult] = await Promise.all([
        datastore.sendNativeQuery(
          `SELECT COUNT(*) AS total FROM ${spec.table}`
        ),
        datastore.sendNativeQuery(
          `SELECT COUNT(*) AS total, MIN(${spec.timestamp}) AS oldest
          FROM ${spec.table}
          WHERE ${spec.timestamp} < ? ${deliveryFilter}`,
          [spec.cutoff]
        )
      ])
      const rowCount = Number(rows(countResult)[0]?.total || 0)
      const backlog = rows(backlogResult)[0] || {}
      const backlogRows = Number(backlog.total || 0)
      const retentionLagMs =
        backlogRows > 0
          ? Math.max(0, spec.cutoff - Number(backlog.oldest || spec.cutoff))
          : 0

      result.tables[spec.key] = {
        cutoff: spec.cutoff,
        deletedRows,
        batches,
        rowCount,
        backlogRows,
        retentionLagMs
      }
      result.deletedRows += deletedRows
      result.rowCount += rowCount
      result.hasBacklog ||= backlogRows > 0
      result.retentionLagMs = Math.max(result.retentionLagMs, retentionLagMs)
    }

    return result
  }
}

function rows(result) {
  return result.rows || result || []
}
