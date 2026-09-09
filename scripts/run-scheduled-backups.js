module.exports = {
  friendlyName: 'Run scheduled backups',

  description:
    'Check if scheduled backups are due and run them for all backup-supported services.',

  quest: {
    interval: '1 minute',
    withoutOverlapping: true
  },

  fn: async function () {
    // Retry cleanup before new work, preserving records when deletion is unavailable.
    const failed = await Backup.find({
      status: 'failed',
      objectKey: { '!=': null }
    }).limit(100)
    for (const backup of failed.filter(
      (item) => item.objectKey && item.storage?.cleanupPending
    )) {
      try {
        await sails.helpers.backup.deleteBackupObject.with({
          objectKey: backup.objectKey,
          backupId: backup.id
        })
        await Backup.updateOne({ id: backup.id }).set({
          objectKey: null,
          storage: { ...backup.storage, cleanupPending: false }
        })
      } catch {
        /* Retry on the next scheduled run. */
      }
    }
    try {
      await sails.helpers.backup.getStorageConfig()
    } catch {
      sails.log.verbose('Scheduled backups: storage not configured, skipping')
      return
    }

    // 2. Check if backup schedule is enabled and due
    const scheduleJson = await sails.helpers.setting.get('backupSchedule')
    if (!scheduleJson) return

    let schedule
    try {
      schedule = JSON.parse(scheduleJson)
    } catch {
      return
    }

    if (!schedule.enabled || !schedule.intervalHours) return

    const intervalMs = schedule.intervalHours * 60 * 60 * 1000
    const lastRunAt = schedule.lastRunAt || 0
    const now = Date.now()

    if (now - lastRunAt < intervalMs) return

    // 3. Find all running services that support backups
    const services = await Service.find({ status: 'running' })
    const backupableServices = services.filter((s) =>
      Service.isBackupSupported(s.type)
    )

    if (backupableServices.length === 0) {
      sails.log.verbose(
        'Scheduled backups: no backup-supported services running'
      )
      return
    }

    sails.log.info(
      `Running scheduled backups for ${backupableServices.length} service(s)`
    )

    // 4. Create and run backups
    for (const service of backupableServices) {
      try {
        const backup = await Backup.create({
          status: 'pending',
          type: 'scheduled',
          service: service.id
        }).fetch()

        await sails.helpers.backup.runBackup(backup.id)
      } catch (err) {
        sails.log.error(
          `Scheduled backup failed for ${service.name}: ${err.message}`
        )
      }
    }

    // 5. Prune old backups beyond retention count
    const retentionCount = schedule.retentionCount || 10
    for (const service of backupableServices) {
      try {
        const completed = await Backup.find({
          where: { service: service.id, status: 'completed' },
          sort: 'completedAt DESC'
        })
        if (completed.length <= retentionCount) continue

        const toDelete = completed.slice(retentionCount)
        sails.log.info(
          `Pruning ${toDelete.length} old backup(s) for service ${service.name}`
        )

        for (const old of toDelete) {
          // Delete from S3 if key exists
          if (old.objectKey || old.s3Key) {
            try {
              await sails.helpers.backup.deleteBackupObject.with({
                objectKey: old.objectKey || old.s3Key,
                backupId: old.id
              })
            } catch (err) {
              sails.log.warn(
                `Could not delete backup object ${old.id}: ${err.message}`
              )
              continue
            }
          }
          await Backup.destroyOne({ id: old.id })
        }
      } catch (err) {
        sails.log.error(
          `Backup pruning failed for ${service.name}: ${err.message}`
        )
      }
    }

    // 6. Update lastRunAt
    schedule.lastRunAt = now
    await sails.helpers.setting.set('backupSchedule', JSON.stringify(schedule))
  }
}
