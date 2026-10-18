module.exports = {
  friendlyName: 'Get image retention policy',
  description:
    'Validate safe cleanup limits and respect an explicit removal opt-out.',
  inputs: {},
  exits: { success: { outputType: 'ref' } },

  fn: async function () {
    const config = sails.config.imageRetention || {}
    const policy = {
      remove: config.remove === undefined || config.remove === true
    }
    for (const [key, fallback, minimum, maximum] of [
      ['minimumAgeDays', 14, 14, 3650],
      ['keepSuccessful', 3, 3, 100],
      ['maxImages', 5000, 1, 10000],
      ['maxContainers', 1000, 1, 10000],
      ['maxRecords', 20000, 1, 100000],
      ['inspectBatchSize', 50, 1, 100],
      ['maxRemovals', 100, 1, 100],
      ['maxRunMs', 300000, 1000, 600000]
    ]) {
      const value = config[key] === undefined ? fallback : config[key]
      if (!Number.isInteger(value) || value < minimum || value > maximum)
        throw new Error(`Invalid image retention limit: ${key}`)
      policy[key] = value
    }
    if (
      config.pinnedImages !== undefined &&
      (!Array.isArray(config.pinnedImages) ||
        config.pinnedImages.length > policy.maxImages ||
        config.pinnedImages.some(
          (ref) => typeof ref !== 'string' || !ref.trim()
        ))
    )
      throw new Error('Invalid image retention pins')
    policy.pinnedImages = [...new Set(config.pinnedImages || [])]
    return policy
  }
}
