module.exports = {
  friendlyName: 'Get build cache retention policy',
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    const config = sails.config.buildCacheRetention || {}
    const policy = {
      remove: config.remove === undefined || config.remove === true
    }
    for (const [key, fallback, min, max] of [
      ['minimumUnusedHours', 168, 168, 87600],
      ['keepStorageBytes', 20 * 1024 ** 3, 10 * 1024 ** 3, 1024 ** 4],
      ['maxRunMs', 300000, 1000, 600000]
    ]) {
      const value = config[key] === undefined ? fallback : config[key]
      if (!Number.isSafeInteger(value) || value < min || value > max)
        throw new Error(`Invalid build cache retention limit: ${key}`)
      policy[key] = value
    }
    return policy
  }
}
