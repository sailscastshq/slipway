const { create } = require('../../lib/instance-quest')

module.exports = function (sails) {
  return {
    initialize: async function () {
      // Console job children must never observe or rewrite the web runtime's ledger.
      if (sails.config.environment === 'console' || process.env.QUEST_RUN_ID)
        return
      const adapter = create(sails)
      await adapter.initialize()
      sails.instanceQuest = adapter
      sails.on('lower', () => adapter.close())
    }
  }
}
