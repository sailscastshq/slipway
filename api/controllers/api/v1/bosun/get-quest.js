module.exports = {
  friendlyName: 'Get instance Quest',
  exits: { unavailable: { statusCode: 503 } },
  fn: async function () {
    if (!sails.instanceQuest)
      throw { unavailable: { error: 'Instance Quest is unavailable.' } }
    return sails.instanceQuest.snapshot()
  }
}
