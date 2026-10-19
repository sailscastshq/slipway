const workspace = require('../../../../lib/instance-quest-workspace')

module.exports = {
  friendlyName: 'Get instance Quest',
  exits: { unavailable: { statusCode: 503 } },
  fn: async function () {
    if (!sails.instanceQuest)
      throw { unavailable: { error: 'Instance Quest is unavailable.' } }
    return workspace.read(sails)
  }
}
