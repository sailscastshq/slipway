const { create } = require('../../lib/instance-quest')

module.exports = function (sails) {
  return {
    initialize: async function () {
      // Console job children must never observe or rewrite the web runtime's ledger.
      if (sails.config.environment === 'console' || process.env.QUEST_RUN_ID)
        return
      const adapter = create(sails)
      try {
        await adapter.initialize()
        sails.instanceQuest = adapter
        sails.on('lower', () => adapter.close())
      } catch {
        // A torn history record or unavailable volume disables manual admission,
        // never the rest of Slipway. Preserve the files for operator inspection.
        await adapter.close()
        const message =
          'Instance Quest history is unavailable. Manual runs are disabled pending storage recovery.'
        sails.log.error(message)
        sails.instanceQuest = {
          snapshot: async () => ({
            available: false,
            error: message,
            jobs: [],
            runs: [],
            liveLogs: false
          }),
          trigger: async () => {
            throw Object.assign(new Error(message), { status: 503 })
          }
        }
      }
    }
  }
}
