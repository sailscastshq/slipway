const recovery = require('./deployment-recovery')

// Read-only preparation plus a short durable recheck. A dead process alone is
// insufficient: its Docker command or resource cleanup may still be running.
module.exports = function (sails) {
  let preparedAt = 0
  async function idle() {
    const m = sails.models
    if (
      !m?.deploymentjob ||
      !m.deployment ||
      !m.deploymentlease ||
      !m.cleanupoperation ||
      !m.setting
    )
      return false
    const counts = await Promise.all([
      m.deploymentjob.count({
        stage: { nin: ['complete', 'failed', 'cancelled'] }
      }),
      m.deployment.count({
        status: { in: ['pending', 'building', 'pushing', 'deploying'] }
      }),
      m.deploymentlease.count({}),
      m.cleanupoperation.count({ status: { nin: ['complete'] } }),
      m.setting.count({ key: { startsWith: recovery.HOLD_PREFIX } })
    ])
    return counts.every((count) => count === 0)
  }
  return {
    prepare: async () => {
      try {
        if (!(await idle())) return false
        const cache = await sails.helpers.buildCacheRetention.getInventory()
        if (cache.active !== 0) return false
        preparedAt = Date.now()
        return true
      } catch {
        return false
      }
    },
    verify: async () => {
      const age = Date.now() - preparedAt
      return preparedAt > 0 && age >= 0 && age <= 5000 && (await idle())
    }
  }
}
