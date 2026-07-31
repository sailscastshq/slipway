const DISK_ALERT_COOLDOWN_MS = 15 * 60 * 1000

module.exports = {
  friendlyName: 'Run observability maintenance',

  description:
    'Prune, count, and check disk health independently of Docker metrics.',

  inputs: {
    now: {
      type: 'number',
      defaultsTo: 0
    }
  },

  fn: async function ({ now }) {
    const attemptedAt = now || Date.now()

    try {
      const config = sails.config.custom.observability
      await sails.helpers.lookout.ensureObservabilitySchema()
      const previous = await ObservabilityJobHealth.findOne({
        jobName: 'retention'
      })
      const prune = await sails.helpers.lookout.pruneObservability.with({
        now: attemptedAt,
        containerRetentionMs: config.containerMetricsRetentionMs,
        telemetryRetentionMs: config.applicationTelemetryRetentionMs,
        batchSize: config.pruneBatchSize,
        maxBatches: config.maxPruneBatchesPerRun
      })
      const disk = await checkDiskSpace({
        now: attemptedAt,
        previousDetails: previous?.details || {}
      })
      const completedAt = Date.now()
      const details = { prune, disk }

      await sails.helpers.lookout.recordObservabilityHealth.with({
        jobName: 'retention',
        succeeded: true,
        attemptedAt,
        completedAt,
        rowCount: prune.rowCount,
        details
      })

      if (prune.hasBacklog) {
        sails.log.warn(
          `Lookout: Retention backlog remains (${prune.retentionLagMs}ms behind after deleting ${prune.deletedRows} rows)`
        )
      }

      return details
    } catch (error) {
      const completedAt = Date.now()
      try {
        await sails.helpers.lookout.recordObservabilityHealth.with({
          jobName: 'retention',
          succeeded: false,
          attemptedAt,
          completedAt,
          details: {},
          error: error.message || String(error)
        })
      } catch (healthError) {
        sails.log.warn(
          `Lookout: Could not persist retention failure: ${healthError.message}`
        )
      }
      throw error
    }
  }
}

async function checkDiskSpace({ now, previousDetails }) {
  const diskInfo = await sails.helpers.lookout.getDiskSpace()
  if (!diskInfo) return { available: false, lastAlertAt: null }

  const previousAlertAt = previousDetails.disk?.lastAlertAt || null
  const disk = {
    available: true,
    ...diskInfo,
    lastAlertAt: previousAlertAt
  }

  if (
    diskInfo.usedPercent < 90 ||
    (previousAlertAt && now - previousAlertAt < DISK_ALERT_COOLDOWN_MS)
  ) {
    return disk
  }

  disk.lastAlertAt = now
  sails.log.warn(
    `Lookout: Disk space critical — ${diskInfo.usedPercent}% used, ${diskInfo.available} available`
  )

  try {
    await sails.helpers.notification.sendDiskSpaceAlert.with({
      usedPercent: diskInfo.usedPercent,
      availableGb: diskInfo.available
    })
  } catch (error) {
    disk.alertError = error.message || String(error)
  }

  return disk
}
