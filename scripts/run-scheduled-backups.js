module.exports = {
  friendlyName: 'Run scheduled backups',

  description: 'Check if scheduled backups are due and run them for all backup-supported services.',

  quest: {
    interval: '1 minute',
    withoutOverlapping: true
  },

  fn: async function () {
    // 1. Check if uploads/storage is configured at all
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch { /* ignore */ }

    const hasKey = globalEnvVars.R2_ACCESS_KEY || globalEnvVars.S3_ACCESS_KEY || globalEnvVars.SPACES_ACCESS_KEY || (sails.config.uploads || {}).key
    const hasSecret = globalEnvVars.R2_SECRET_KEY || globalEnvVars.S3_SECRET_KEY || globalEnvVars.SPACES_SECRET_KEY || (sails.config.uploads || {}).secret
    const hasBucket = globalEnvVars.R2_BUCKET || globalEnvVars.S3_BUCKET || globalEnvVars.SPACES_BUCKET || (sails.config.uploads || {}).bucket

    if (!hasKey || !hasSecret || !hasBucket) {
      sails.log.verbose('Scheduled backups: storage not configured, skipping')
      return
    }

    // 2. Check if backup schedule is enabled and due
    const scheduleJson = await sails.helpers.setting.get('backupSchedule')
    if (!scheduleJson) return

    let schedule
    try { schedule = JSON.parse(scheduleJson) } catch { return }

    if (!schedule.enabled || !schedule.intervalHours) return

    const intervalMs = schedule.intervalHours * 60 * 60 * 1000
    const lastRunAt = schedule.lastRunAt || 0
    const now = Date.now()

    if ((now - lastRunAt) < intervalMs) return

    // 3. Find all running services that support backups
    const services = await Service.find({ status: 'running' })
    const backupableServices = services.filter(s => Service.isBackupSupported(s.type))

    if (backupableServices.length === 0) {
      sails.log.verbose('Scheduled backups: no backup-supported services running')
      return
    }

    sails.log.info(`Running scheduled backups for ${backupableServices.length} service(s)`)

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
        sails.log.error(`Scheduled backup failed for ${service.name}: ${err.message}`)
      }
    }

    // 5. Update lastRunAt
    schedule.lastRunAt = now
    await sails.helpers.setting.set('backupSchedule', JSON.stringify(schedule))
  }
}
